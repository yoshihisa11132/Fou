import httpSignature from '@peertube/http-signature';
import { extractDbHost } from '@/misc/convert-host.js'; 
import { shouldBlockInstance } from '@/misc/should-block-instance.js';
import { authUserFromKeyId, getAuthUser } from '@/remote/activitypub/misc/auth-user.js';
import { getApId, isActor } from '@/remote/activitypub/type.js';
import { StatusError } from '@/misc/fetch.js';
import { Resolver } from '@/remote/activitypub/resolver.js';
import { createPerson } from '@/remote/activitypub/models/person.js';
import config from '@/config/index.js';

export type SignatureValidationResult = 'missing' | 'invalid' | 'rejected' | 'valid' | 'always';

async function resolveKeyId(keyId: string, resolver: Resolver): Promise<AuthUser | null> {
	// Do we already know that keyId?
	const authUser = await authUserFromKeyId(keyId);
	if (authUser != null) return authUser;

	// If not, discover it.
	const keyUrl = new URL(keyId);
	keyUrl.hash = ''; // Fragment should not be part of the request.
	
	const keyObject = await resolver.resolve(keyUrl.toString());

	// Does the keyId end up resolving to an Actor?
	if (isActor(keyObject)) {
		await createPerson(keyObject, resolver);
		return await getAuthUser(keyId, getApId(keyObject), resolver);
	}

	// Does the keyId end up resolving to a Key-like?
	const keyData = keyObject as any;
	if (keyData.owner != null && keyData.publicKeyPem != null) {
		await createPerson(keyData.owner, resolver);
		return await getAuthUser(keyId, getApId(keyData.owner), resolver);
	}

	// Cannot be resolved.
	return null;
}

export async function validateFetchSignature(req: IncomingMessage): Promise<SignatureValidationResult> {
	let signature;

	if (config.allowUnsignedFetches === true)
		return 'always';

	try {
		signature = httpSignature.parseRequest(req);
	} catch (e) {
		// TypeScript has wrong typings for Error, meaning I can't extract `name`.
		// No typings for @peertube/http-signature's Errors either.
		// This means we have to report it as missing instead of invalid in cases
		// where the structure is incorrect.
		return 'missing';
	}

	// This old `keyId` format is no longer supported.
	const keyIdLower = signature.keyId.toLowerCase();
	if (keyIdLower.startsWith('acct:'))
		return 'invalid';

	const host = extractDbHost(keyIdLower);

	// Reject if the host is blocked.
	if (await shouldBlockInstance(host))
		return 'rejected';

	const resolver = new Resolver();
	let authUser;
	try {
		authUser = await resolveKeyId(signature.keyId, resolver);
	} catch (e) {
		if (e instanceof StatusError) {
			if (e.isClientError) {
				// Actor is deleted.
				return 'rejected';
			} else {
				throw new Error(`Error in signature ${signature} - ${e.statusCode || e}`);
			}
		}
	}

	if (authUser == null) {
		// Key not found? Unacceptable!
		return 'invalid';
	} else {
		// Found key!
	}

	// Make sure the resolved user matches the keyId host.
	if (authUser.user.host !== host)
		return 'rejected';

	// Verify the HTTP Signature
	const httpSignatureValidated = httpSignature.verifySignature(signature, authUser.key.keyPem);
	if (httpSignatureValidated === true)
		return 'valid';

	// Otherwise, fail.
	return 'invalid';
}
