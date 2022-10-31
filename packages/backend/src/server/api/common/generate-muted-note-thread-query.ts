import { Brackets, SelectQueryBuilder } from 'typeorm';
import { User } from '@/models/entities/user.js';
import { NoteThreadMutings } from '@/models/index.js';

export function generateMutedNoteThreadQuery(q: SelectQueryBuilder<any>, me: { id: User['id'] }) {
	const mutedQuery = NoteThreadMutings.createQueryBuilder('threadMuted')
		.select('threadMuted.threadId')
		.where('threadMuted.userId = :userId', { userId: me.id });

	q.andWhere(`note.threadId NOT IN (${ mutedQuery.getQuery() })`);

	q.setParameters(mutedQuery.getParameters());
}
