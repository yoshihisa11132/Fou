import { IRemoteUser } from '@/models/entities/user.js';
import { verifyMove } from '@/remote/activitypub/models/person.js';
import { move } from '@/services/move.js';
import Resolver from '../../resolver.js';
import { IMove, getApId } from '../../type.js';

export async function move(actor: IRemoteUser, activity: IMove, resolver: Resolver): Promise<void> {
	// actor is not move origin
	if (activity.object == null || getApId(activity.object) !== actor.uri) return;

	// no move target
	if (activity.target == null) return;

	const movedTo = await verifyMove(actor, activity.target, resolver);

	if (movedTo == null) {
		// invalid or unnaccepted move
		return;
	}

	await move(actor, movedTo);
}
