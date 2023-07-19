import { Cache } from '@/misc/cache.js';
import { UserPublickeys } from '@/models/index.js';
import { IRemoteUser } from '@/models/entities/user.js';
import { UserPublickey } from '@/models/entities/user-publickey.js';
import { uriPersonCache, userByIdCache } from '@/services/user-cache.js';
import { createPerson } from '@/remote/activitypub/models/person.js';
import { Resolver } from '@/remote/activitypub/resolver.js';
import { HOUR } from '@/const.js';

export type AuthUser = {
	user: IRemoteUser;
	key: UserPublickey;
};

const publicKeyCache = new Cache<UserPublickey>(
	2 * HOUR,
	(keyId) => UserPublickeys.findOneBy({ keyId }).then(x => x ?? undefined),
);
const publicKeyByUserIdCache = new Cache<UserPublickey>(
	2 * HOUR,
	(userId) => UserPublickeys.findOneBy({ userId }).then(x => x ?? undefined),
);

function authUserFromApId(uri: string): Promise<AuthUser | null> {
	return uriPersonCache.fetch(uri)
		.then(async user => {
			if (!user) return null;
			const key = await publicKeyByUserIdCache.fetch(user.id);
			if (!key) return null;
			return { user, key };
		});
}

export async function authUserFromKeyId(keyId: string): Promise<AuthUser | null> {
	return await publicKeyCache.fetch(keyId)
		.then(async key => {
			if (!key) return null;
			else return {
				user: await userByIdCache.fetch(key.userId),
				key,
			};
		});
}

export async function getAuthUser(keyId: string, actorUri: string, resolver: Resolver): Promise<AuthUser | null> {
	let authUser = await authUserFromKeyId(keyId);
	if (authUser != null) return authUser;

	authUser = await authUserFromApId(actorUri);
	if (authUser != null) return authUser;

	// fetch from remote and then one last try
	await createPerson(actorUri, resolver);
	// if this one still returns null it seems this user really does not exist
	return await authUserFromApId(actorUri);
}
