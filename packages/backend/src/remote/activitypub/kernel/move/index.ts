import { IsNull } from 'typeorm';
import { IRemoteUser } from '@/models/entities/user.js';
import { resolvePerson } from '@/remote/activitypub/models/person.js';
import { Blockings, Followings, Mutings, Users } from '@/models/index.js';
import { createNotification } from '@/services/create-notification.js';
import { createBlock } from '@/services/blocking/create.js';
import { createMute } from '@/services/mute/create.js';
import Resolver from '../../resolver.js';
import { IMove, isActor, getApId } from '../../type.js';

export async function move(actor: IRemoteUser, activity: IMove, resolver: Resolver): Promise<void> {
	// actor is not move origin
	if (activity.object == null || getApId(activity.object) !== actor.uri) return;

	// actor already moved
	if (actor.movedTo != null) return;

	// no move target
	if (activity.target == null) return;

	/* the database resolver can not be used here, because:
	 * 1. It must be ensured that the latest data is used.
	 * 2. The AP representation is needed, because `alsoKnownAs`
	 *    is not stored in the database.
	 * This also checks whether the move target is blocked
	 */
	const movedToAp = await resolver.resolve(getApId(activity.target));

	// move target is not an actor
	if (!isActor(movedToAp)) return;

	// move destination has not accepted
	if (!Array.isArray(movedToAp.alsoKnownAs) || !movedToAp.alsoKnownAs.includes(actor.id)) return;

	// ensure the user exists
	const movedTo = await resolvePerson(getApId(activity.target), resolver, movedToAp);
	// move target is already suspended
	if (movedTo.isSuspended) return;

	// process move for local followers
	const followings = await Followings.find({
		select: {
			followerId: true,
		},
		where: {
			followeeId: actor.id,
			followerHost: IsNull(),
		},
	});

	// create blocks/mutes for the new account analogous to the old account
	const blockings = await Blockings.createQueryBuilder('blocking')
		.leftJoinAndSelect('blocking.blocker', 'blocker')
		// accounts that blocked the previous account
		.where('blockeeId = :blockee', { blockee: actor.id })
		// ... and are not already blocking the new account
		.andWhere('"blocking"."blockerId" NOT IN (SELECT "blockerId" FROM "blocking" WHERE "blockeeId" = :movedTo)', { movedTo: movedTo.id })
		.getRawMany();
	const mutes = await Mutings.createQueryBuilder('muting')
		.leftJoinAndSelect('muting.muter', 'muter')
		// accounts that muted the previous account
		.where('muteeId = :mutee', { mutee: actor.id })
		// ... and are not already muting the new account
		.andWhere('"muting"."muterId" NOT IN (SELECT "muterId" FROM "muting" WHERE "muteeId" = :movedTo)', { movedTo: movedTo.id })
		.getRawMany();

	await Promise.all([
		Users.update(actor.id, {
			movedToId: movedTo.id,
		}),
		...followings.map(async (following) => {
			// TODO: autoAcceptMove?

			await createNotification(following.followerId, 'move', {
				notifierId: actor.id,
				moveTargetId: movedTo.id,
			});
		}),
		...blockings.map(async ({ blocker }) => {
			// create block with all side effects
			await createBlock(blocker, actor);
		}),
		...mutes.map(async ({ muter, expiresAt }) => {
			// create mute with all side effects
			await createMute(muter, actor, expiresAt);
		});
	]);
}
