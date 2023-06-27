import { URL } from 'node:url';
import Bull from 'bull';
import { perform } from '@/remote/activitypub/perform.js';
import Logger from '@/services/logger.js';
import { registerOrFetchInstanceDoc } from '@/services/register-or-fetch-instance-doc.js';
import { Instances } from '@/models/index.js';
import { apRequestChart, federationChart, instanceChart } from '@/services/chart/index.js';
import { extractPunyHost } from '@/misc/convert-host.js';
import { getApId } from '@/remote/activitypub/type.js';
import { fetchInstanceMetadata } from '@/services/fetch-instance-metadata.js';
import { Resolver } from '@/remote/activitypub/resolver.js';
import { LdSignature } from '@/remote/activitypub/misc/ld-signature.js';
import { AuthUser, getAuthUser } from '@/remote/activitypub/misc/auth-user.js';
import { InboxJobData } from '@/queue/types.js';
import { shouldBlockInstance } from '@/misc/should-block-instance.js';
import { verifyHttpSignature } from '@/remote/http-signature.js';

const logger = new Logger('inbox');

// Processing when an activity arrives in the user's inbox
export default async (job: Bull.Job<InboxJobData>): Promise<string> => {
	const signature = job.data.signature;	// HTTP-signature
	const activity = job.data.activity;
	const resolver = new Resolver();

	//#region Log
	const info = Object.assign({}, activity) as any;
	delete info['@context'];
	logger.debug(JSON.stringify(info, null, 2));
	//#endregion

	const validated = await verifyHttpSignature(signature, resolver, getApId(activity.actor));
	let authUser = validated.authUser;

	// The signature must be valid.
	// The signature must also match the actor otherwise anyone could sign any activity.
	if (validated.status !== 'valid' || validated.authUser.user.uri !== activity.actor) {
		// Last resort: LD-Signature
		if (activity.signature) {
			if (activity.signature.type !== 'RsaSignature2017') {
				return `skip: unsupported LD-signature type ${activity.signature.type}`;
			}

			// get user based on LD-Signature key id.
			// lets assume that the creator has this common form:
			// <https://example.com/users/user#main-key>
			// Then we can use it as the key id and (without fragment part) user id.
			authUser = await getAuthUser(activity.signature.creator, activity.signature.creator.replace(/#.*$/, ''), resolver);

			if (authUser == null) {
				return 'skip: failed to resolve LD-Signature user';
			}

			// LD-Signature verification
			const ldSignature = new LdSignature();
			const verified = await ldSignature.verifyRsaSignature2017(activity, authUser.key.keyPem).catch(() => false);
			if (!verified) {
				return 'skip: LD-Signatureの検証に失敗しました';
			}

			// Again, the actor must match.
			if (authUser.user.uri !== activity.actor) {
				return `skip: LD-Signature user(${authUser.user.uri}) !== activity.actor(${activity.actor})`;
			}

			// Stop if the host is blocked.
			const ldHost = extractPunyHost(authUser.user.uri);
			if (await shouldBlockInstance(ldHost)) {
				return `Blocked request: ${ldHost}`;
			}
		} else {
			return `skip: http-signature verification failed and no LD-Signature. keyId=${signature.keyId}`;
		}
	}

	// authUser cannot be null at this point:
	// either it was already not null because the HTTP signature was valid
	// or, if the LD signature was not verified, this function will already have returned.
	authUser = authUser as AuthUser;

	// Verify that the actor's host is not blocked
	const signerHost = extractPunyHost(authUser.user.uri!);
	if (await shouldBlockInstance(signerHost)) {
		return `Blocked request: ${signerHost}`;
	}

	if (typeof activity.id === 'string') {
		// Verify that activity and actor are from the same host.
		const activityIdHost = extractPunyHost(activity.id);
		if (signerHost !== activityIdHost) {
			return `skip: signerHost(${signerHost}) !== activity.id host(${activityIdHost}`;
		}

		// Verify that the id has a sane length
		if (activity.id.length > 2048) {
			return `skip: overly long id from ${signerHost}`;
		}
	}

	// Update stats
	registerOrFetchInstanceDoc(authUser.user.host).then(i => {
		Instances.update(i.id, {
			latestRequestReceivedAt: new Date(),
			lastCommunicatedAt: new Date(),
			isNotResponding: false,
		});

		fetchInstanceMetadata(i);

		instanceChart.requestReceived(i.host);
		apRequestChart.inbox();
		federationChart.inbox(i.host);
	});

	// process the activity
	await perform(authUser.user, activity, resolver);
	return 'ok';
};
