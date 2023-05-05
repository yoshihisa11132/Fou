import { genId } from '@/misc/gen-id.js';
import { Mutings, NoteWatchings } from '@/models/index.js';
import { Muting } from '@/models/entities/muting.js';
import { publishUserEvent } from '@/services/stream.js';
import define from '@/server/api/define.js';
import { ApiError } from '@/server/api/error.js';
import { getUser } from '@/server/api/common/getters.js';
import { createMute } from '@/services/mute/create.js';

export const meta = {
	tags: ['account'],

	requireCredential: true,

	kind: 'write:mutes',

	errors: ['NO_SUCH_USER', 'MUTEE_IS_YOURSELF', 'ALREADY_MUTING'],
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		expiresAt: {
			type: 'integer',
			nullable: true,
			description: 'A Unix Epoch timestamp that must lie in the future. `null` means an indefinite mute.',
		},
	},
	required: ['userId'],
} as const;

// eslint-disable-next-line import/no-default-export
export default define(meta, paramDef, async (ps, user) => {
	const muter = user;

	// 自分自身
	if (user.id === ps.userId) throw new ApiError('MUTEE_IS_YOURSELF');

	// Get mutee
	const mutee = await getUser(ps.userId);

	// Check if already muting
	const exist = await Mutings.countBy({
		muterId: muter.id,
		muteeId: mutee.id,
	});

	if (exist) throw new ApiError('ALREADY_MUTING');

	if (ps.expiresAt && ps.expiresAt <= Date.now()) {
		return;
	}

	const expiresAt = ps.expiresAt ? new Date(ps.expiresAt) : null;

	await createMute(muter, mutee, expiresAt);
});
