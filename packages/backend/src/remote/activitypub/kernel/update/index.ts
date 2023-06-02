import { IRemoteUser } from '@/models/entities/user.js';
import { getApId, getOneApId, getApType, IUpdate, isActor, isPost } from '@/remote/activitypub/type.js';
import { apLogger } from '@/remote/activitypub/logger.js';
import { updateQuestion } from '@/remote/activitypub/models/question.js';
import { Resolver } from '@/remote/activitypub/resolver.js';
import { updatePerson } from '@/remote/activitypub/models/person.js';
import { update as updateNote } from '@/remote/activitypub/kernel/update/note.js';

/**
 * Updateアクティビティを捌きます
 */
export default async (actor: IRemoteUser, activity: IUpdate, resolver: Resolver): Promise<string> => {
	if ('actor' in activity && actor.uri !== activity.actor) {
		return 'skip: invalid actor';
	}

	apLogger.debug('Update');

	const object = await resolver.resolve(activity.object).catch(e => {
		apLogger.error(`Resolution failed: ${e}`);
		throw e;
	});

	if (isActor(object)) {
		if (actor.uri !== getApId(object)) {
			return 'skip: actor id !== updated actor id';
		}

		await updatePerson(object, resolver);
		return 'ok: Person updated';
	} else if (getApType(object) === 'Question') {
		await updateQuestion(object, resolver).catch(e => console.log(e));
		return 'ok: Question updated';
	} else if (isPost(object)) {
		return await updateNote(actor, object, resolver);
	} else {
		return `skip: Unknown type: ${getApType(object)}`;
	}
};
