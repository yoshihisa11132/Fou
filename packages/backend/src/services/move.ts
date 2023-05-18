import { IsNull } from 'typeorm';
import { User } from '@/models/entities/user.js';
import { Blockings, Followings, Mutings, Users } from '@/models/index.js';
import { createNotification } from '@/services/create-notification.js';
import { createBlock } from '@/services/blocking/create.js';
import { createMute } from '@/services/mute/create.js';

/**
 * Triggers notifications and other side effects after the move of an actor to another actor.
 */
export async function move(origin: User, movedTo: User): Promise<void> {
	// process move for local followers
	const followings = await Followings.find({
		select: {
			followerId: true,
		},
		where: {
			followeeId: origin.id,
			followerHost: IsNull(),
		},
	});

	// create blocks/mutes for the new account analogous to the old account
	const blockings = await Blockings.createQueryBuilder('blocking')
		.leftJoinAndSelect('blocking.blocker', 'blocker')
		// accounts that blocked the previous account
		.where('blockeeId = :blockee', { blockee: origin.id })
		// ... and are not already blocking the new account
		.andWhere('"blocking"."blockerId" NOT IN (SELECT "blockerId" FROM "blocking" WHERE "blockeeId" = :movedTo)', { movedTo: movedTo.id })
		.getRawMany();
	const mutes = await Mutings.createQueryBuilder('muting')
		.leftJoinAndSelect('muting.muter', 'muter')
		// accounts that muted the previous account
		.where('muteeId = :mutee', { mutee: origin.id })
		// ... and are not already muting the new account
		.andWhere('"muting"."muterId" NOT IN (SELECT "muterId" FROM "muting" WHERE "muteeId" = :movedTo)', { movedTo: movedTo.id })
		.getRawMany();

	await Promise.all([
		Users.update(origin.id, {
			movedToId: movedTo.id,
		}),
		...followings.map(async (following) => {
			// TODO: autoAcceptMove?

			await createNotification(following.followerId, 'move', {
				notifierId: origin.id,
				moveTargetId: movedTo.id,
			});
		}),
		...blockings.map(async ({ blocker }) => {
			// create block with all side effects
			await createBlock(blocker, origin);
		}),
		...mutes.map(async ({ muter, expiresAt }) => {
			// create mute with all side effects
			await createMute(muter, origin, expiresAt);
		});
	]);
}
