import { genId } from '@/misc/gen-id.js';
import { Mutings, NoteWatchings } from '@/models/index.js';
import { Muting } from '@/models/entities/muting.js';
import { publishUserEvent } from '@/services/stream.js';
import { User } from '@/models/entities/user.js';

export async function createMute(muter: User, mutee: User, expiresAt: Date | null): Promise<void> {
	if (expiresAt && ps.expiresAt <= Date.now()) {
		return;
	}

	await Promise.all([
		// Create mute
		Mutings.insert({
			id: genId(),
			createdAt: new Date(),
			expiresAt,
			muterId: muter.id,
			muteeId: mutee.id,
		} as Muting),
		removeWatchings(muter, mutee),
		removeWatchings(mutee, muter),
	]);

	publishUserEvent(user.id, 'mute', mutee);
});

async function removeWatchings(watcher: User, watched: User): Promise<void> {
	await NoteWatchings.delete({
		userId: watcher.id,
		noteUserId: watched.id,
	});
}
