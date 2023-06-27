import { URL } from 'node:url';
import { extractPunyHost } from "@/misc/convert-host.js";
import { shouldBlockInstance } from "@/misc/should-block-instance.js";
import httpSignature from "@peertube/http-signature";
import { Resolver } from "./activitypub/resolver.js";
import { StatusError } from "@/misc/fetch.js";
import { AuthUser, authUserFromKeyId, getAuthUser } from "./activitypub/misc/auth-user.js";
import { ApObject, getApId, isActor } from "./activitypub/type.js";
import { createPerson } from "./activitypub/models/person.js";

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

export type SignatureValidationResult = {
	status: 'missing' | 'invalid' | 'rejected';
	authUser: AuthUser | null;
} | {
	status: 'valid';
	authUser: AuthUser;
};

export async function verifyHttpSignature(signature: httpSignature.IParsedSignature, resolver: Resolver, actor?: ApObject): Promise<SignatureValidationResult> {
	// This old `keyId` format is no longer supported.
	const keyIdLower = signature.keyId.toLowerCase();
	if (keyIdLower.startsWith('acct:')) return { status: 'invalid', authUser: null };

	const host = extractPunyHost(keyIdLower);

	// Reject if the host is blocked.
	if (await shouldBlockInstance(host)) return { status: 'rejected', authUser: null };

	let authUser = null;
	try {
		if (actor != null) {
			authUser = await getAuthUser(signature.keyId, getApId(actor), resolver);
		} else {
			authUser = await resolveKeyId(signature.keyId, resolver);
		}
	} catch (e) {
		if (e instanceof StatusError) {
			if (e.isClientError) {
				// Actor is deleted.
				return { status: 'rejected', authUser };
			} else {
				throw new Error(`Error in signature ${signature} - ${e.statusCode || e}`);
			}
		}
	}

	if (authUser == null) {
		// Key not found? Unacceptable!
		return { status: 'invalid', authUser };
	} else {
		// Found key!
	}

	// Make sure the resolved user matches the keyId host.
	if (authUser.user.host !== host) return { status: 'rejected', authUser };

	// Verify the HTTP Signature
	const httpSignatureValidated = httpSignature.verifySignature(signature, authUser.key.keyPem);
	if (httpSignatureValidated === true)
		return {
			status: 'valid',
			authUser,
		};

	// Otherwise, fail.
	return { status: 'invalid', authUser };
}
