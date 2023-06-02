import { IRemoteUser } from '@/models/entities/user.js';
import { getApId } from '@/remote/activitypub/type.js';
import { Resolver } from '@/remote/activitypub/resolver.js';
import { Notes } from '@/models/index.js';
import createNote from '@/remote/activitypub/kernel/create/note.js';
import { getApLock } from '@/misc/app-lock.js';
import { updateNote } from '@/remote/activitypub/models/note.js';

export async function update(actor: IRemoteUser, note: IObject, resolver: Resolver): Promise<string> {
	// check whether note exists
	const uri = getApId(note);
	const exists = await Notes.findOneBy({ uri });

	if (exists == null) {
		// does not yet exist, handle as if this was a create activity
		// and since this is not a direct creation, handle it silently
		createNote(resolver, actor, note, true);

		const unlock = await getApLock(uri);
		try {
			// if creating was successful...
			const existsNow = await Notes.findOneByOrFail({ uri });
			// set the updatedAt timestamp since the note was changed
			await Notes.update(existsNow.id, { updatedAt: new Date() });
			return 'ok: unknown note created and marked as updated';
		} catch (e) {
			return `skip: updated note unknown and creating rejected: ${e.message}`;
		} finally {
			unlock();
		}
	} else {
		// check that actor is authorized to update this note
		if (actor.id !== exists.userId) {
			return 'skip: actor not authorized to update Note';
		}
		// this does not redo the checks from the Create Note kernel
		// since if the note made it into the database, we assume
		// those checks must have been passed before.

		const unlock = await getApLock(uri);
		try {
			await updateNote(note, actor, resolver);
			return 'ok: note updated';
		} catch (e) {
			return `skip: update note rejected: ${e.message}`;
		} finally {
			unlock();
		}
	}
}
