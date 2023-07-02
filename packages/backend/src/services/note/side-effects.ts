import { ArrayOverlap, Not, In } from 'typeorm';
import * as mfm from 'mfm-js';
import { publishMainStream, publishNoteStream, publishNotesStream } from '@/services/stream.js';
import { DeliverManager } from '@/remote/activitypub/deliver-manager.js';
import { renderActivity } from '@/remote/activitypub/renderer/index.js';
import { resolveUser } from '@/remote/resolve-user.js';
import { insertNoteUnread } from '@/services/note/unread.js';
import { extractMentions } from '@/misc/extract-mentions.js';
import { extractHashtags } from '@/misc/extract-hashtags.js';
import { Note } from '@/models/entities/note.js';
import { AntennaNotes, Mutings, Users, NoteWatchings, Notes, Instances, MutedNotes, Channels, ChannelFollowings, NoteThreadMutings } from '@/models/index.js';
import { User, ILocalUser, IRemoteUser } from '@/models/entities/user.js';
import { genId } from '@/misc/gen-id.js';
import { notesChart, perUserNotesChart, activeUsersChart, instanceChart } from '@/services/chart/index.js';
import { checkHitAntenna } from '@/misc/check-hit-antenna.js';
import { checkWordMute } from '@/misc/check-word-mute.js';
import { countSameRenotes } from '@/misc/count-same-renotes.js';
import { getAntennas } from '@/misc/antenna-cache.js';
import { endedPollNotificationQueue } from '@/queue/queues.js';
import { webhookDeliver } from '@/queue/index.js';
import { getActiveWebhooks } from '@/misc/webhook-cache.js';
import { renderNoteOrRenoteActivity } from '@/remote/activitypub/renderer/note-or-renote.js';
import { updateHashtags } from '../update-hashtag.js';
import { registerOrFetchInstanceDoc } from '../register-or-fetch-instance-doc.js';
import { createNotification } from '../create-notification.js';
import { addNoteToAntenna } from '../add-note-to-antenna.js';
import { deliverToRelays } from '../relay.js';
import { mutedWordsCache, index } from './index.js';
import { Polls } from '@/models/index.js';
import { Poll } from '@/models/entities/poll.js';


type NotificationType = 'reply' | 'renote' | 'quote' | 'mention' | 'update';

class NotificationManager {
	private notifier: { id: User['id']; };
	private note: Note;
	private queue: {
		target: ILocalUser['id'];
		reason: NotificationType;
	}[];

	constructor(notifier: { id: User['id']; }, note: Note) {
		this.notifier = notifier;
		this.note = note;
		this.queue = [];
	}

	public push(notifiee: ILocalUser['id'], reason: NotificationType): void {
		// No notification to yourself.
		if (this.notifier.id === notifiee) return;

		const exist = this.queue.find(x => x.target === notifiee);

		if (exist) {
			// If you have been "mentioned and replied to," make the notification as a reply, not as a mention.
			if (reason !== 'mention') {
				exist.reason = reason;
			}
		} else {
			this.queue.push({
				reason,
				target: notifiee,
			});
		}
	}

	public async deliver(): Promise<void> {
		for (const x of this.queue) {
			// check if the sender or thread are muted
			const userMuted = await Mutings.countBy({
				muterId: x.target,
				muteeId: this.notifier.id,
			});

			const threadMuted = await NoteThreadMutings.countBy({
				userId: x.target,
				threadId: In([
					// replies
					this.note.threadId ?? this.note.id,
					// renotes
					this.note.renoteId ?? undefined,
				]),
				mutingNotificationTypes: ArrayOverlap([x.reason]),
			});

			if (!userMuted && !threadMuted) {
				createNotification(x.target, x.reason, {
					notifierId: this.notifier.id,
					noteId: this.note.id,
				});
			}
		}
	}
}

/**
 * Perform side effects for a Note such as incrementing statistics, updating hashtag usage etc.
 *
 * @param user The author of the note.
 * @param note The note for which the side effects should be performed.
 * @param silent Whether notifications and similar side effects should be suppressed.
 * @param created Whether statistics should be incremented (i.e. the note was inserted and not updated in the database)
 */
export async function sideEffects(user: User, note: Note, silent = false, created = true): Promise<void> {
	if (created) {
		// Update Statistics
		notesChart.update(note, true);
		perUserNotesChart.update(user, note, true);
		Users.createQueryBuilder().update()
			.set({
				updatedAt: new Date(),
				notesCount: () => '"notesCount" + 1',
			})
			.where('id = :id', { id: user.id })
			.execute();

		if (Users.isLocalUser(user)) {
			activeUsersChart.write(user);
		} else {
			// Remote user, register host
			registerOrFetchInstanceDoc(user.host).then(i => {
				Instances.increment({ id: i.id }, 'notesCount', 1);
				instanceChart.updateNote(i.host, note, true);
			});
		}

		// Channel
		if (note.channelId) {
			ChannelFollowings.findBy({ followeeId: note.channelId }).then(followings => {
				for (const following of followings) {
					insertNoteUnread(following.followerId, note, {
						isSpecified: false,
						isMentioned: false,
					});
				}
			});

			Channels.increment({ id: note.channelId }, 'notesCount', 1);
			Channels.update(note.channelId, {
				lastNotedAt: new Date(),
			});

			const count = await Notes.countBy({
				userId: user.id,
				channelId: note.channelId,
			});

			// This process takes place after the note is created, so if there is only one note, you can determine that it is the first submission.
			// TODO: but there's also the messiness of deleting a note and posting it multiple times, which is incremented by the number of times it's posted, so I'd like to do something about that.
			if (count === 1) {
				Channels.increment({ id: note.channelId }, 'usersCount', 1);
			}
		}

		if (note.replyId) {
			Notes.increment({ id: note.replyId }, 'repliesCount', 1);
		}

		// When there is no re-note of the specified note by the specified user except for this post
		if (note.renoteId && (await countSameRenotes(user.id, note.renoteId, note.id) === 0)) {
			Notes.createQueryBuilder().update()
				.set({
					renoteCount: () => '"renoteCount" + 1',
					score: () => '"score" + 1',
				})
				.where('id = :id', { id: note.renoteId })
				.execute();
		}

		// create job for ended poll notifications
		if (note.hasPoll) {
			Polls.findOneByOrFail({ noteId: note.id })
				.then((poll: Poll) => {
					if (poll.expiresAt) {
						const delay = poll.expiresAt.getTime() - Date.now();
						endedPollNotificationQueue.add({
							noteId: note.id,
						}, {
							delay,
							removeOnComplete: true,
						});
					}
				})
		}
	}

	const { mentionedUsers, tags } = await extractFromMfm(user, note);

	// Hashtag Update
	if (note.visibility === 'public' || note.visibility === 'home') {
		updateHashtags(user, tags);
	}

	// Word mute
	mutedWordsCache.fetch('').then(us => {
		for (const u of us) {
			checkWordMute(note, { id: u.userId }, u.mutedWords).then(shouldMute => {
				if (shouldMute) {
					MutedNotes.insert({
						id: genId(),
						userId: u.userId,
						noteId: note.id,
						reason: 'word',
					});
				}
			});
		}
	});

	// Antenna
	if (!created) {
		// Provisionally remove from antenna, it may be added again in the next step.
		// But if it is not removed, it can cause duplicate key errors when trying to
		// add it to the same antenna again.
		await AntennaNotes.delete({
			noteId: note.id,
		});
	}
	getAntennas()
		.then(async antennas => {
			await Promise.all(antennas.map(antenna => {
				return checkHitAntenna(antenna, note, user)
					.then(hit => { if (hit) return addNoteToAntenna(antenna, note, user); });
			}));
		});

	// Notifications
	if (!silent && created) {
		// Create unread notifications
		if (note.visibility === 'specified') {
			if (note.visibleUserIds == null) {
				throw new Error('specified note but does not have any visible user ids');
			}

			Users.findBy({
				id: In(note.visibleUserIds),
			}).then((visibleUsers: User[]) => {
				visibleUsers
					.filter(u => Users.isLocalUser(u))
					.forEach(u => {
						insertNoteUnread(u.id, note, {
							isSpecified: true,
							isMentioned: false,
						});
					});
			})
		} else {
			mentionedUsers
				.filter(u => Users.isLocalUser(u))
				.forEach(u => {
					insertNoteUnread(u.id, note, {
						isSpecified: false,
						isMentioned: true,
					});
				})
		}

		publishNotesStream(note);

		const webhooks = await getActiveWebhooks().then(webhooks => webhooks.filter(x => x.userId === user.id && x.on.includes('note')));
		for (const webhook of webhooks) {
			webhookDeliver(webhook, 'note', {
				note: await Notes.pack(note, user),
			});
		}

		const nm = new NotificationManager(user, note);
		const nmRelatedPromises = [];

		await createMentionedEvents(mentionedUsers, note, nm);

		// If it is in reply to another note
		if (note.replyId) {
			const reply = await Notes.findOneByOrFail({ id: note.replyId });

			// Fetch watchers
			nmRelatedPromises.push(notifyWatchers(note.replyId, user, nm, 'reply'));

			// Notifications
			if (reply.userHost === null) {
				const threadMuted = await NoteThreadMutings.countBy({
					userId: reply.userId,
					threadId: reply.threadId ?? reply.id,
				});

				if (!threadMuted) {
					nm.push(reply.userId, 'reply');

					const packedReply = await Notes.pack(note, { id: reply.userId });
					publishMainStream(reply.userId, 'reply', packedReply);

					const webhooks = (await getActiveWebhooks()).filter(x => x.userId === reply.userId && x.on.includes('reply'));
					for (const webhook of webhooks) {
						webhookDeliver(webhook, 'reply', {
							note: packedReply,
						});
					}
				}
			}
		}

		// If it is a renote
		if (note.renoteId) {
			const type = note.text ? 'quote' : 'renote';
			const renote = await Notes.findOneByOrFail({ id : note.renoteId });

			// Notify
			if (renote.userHost === null) {
				nm.push(renote.userId, type);
			}

			// Fetch watchers
			nmRelatedPromises.push(notifyWatchers(note.renoteId, user, nm, type));

			// Publish event
			if ((user.id !== renote.userId) && renote.userHost === null) {
				const packedRenote = await Notes.pack(note, { id: renote.userId });
				publishMainStream(renote.userId, 'renote', packedRenote);

				const webhooks = (await getActiveWebhooks()).filter(x => x.userId === renote.userId && x.on.includes('renote'));
				for (const webhook of webhooks) {
					webhookDeliver(webhook, 'renote', {
						note: packedRenote,
					});
				}
			}
		}

		Promise.all(nmRelatedPromises).then(() => {
			nm.deliver();
		});

		//#region AP deliver
		if (Users.isLocalUser(user) && !note.localOnly && created) {
			(async () => {
				const noteActivity = renderActivity(await renderNoteOrRenoteActivity(note));
				const dm = new DeliverManager(user, noteActivity);

				// Delivered to remote users who have been mentioned
				for (const u of mentionedUsers.filter(u => Users.isRemoteUser(u))) {
					dm.addDirectRecipe(u as IRemoteUser);
				}

				// If the post is a reply and the poster is a local user and the poster of the post to which you are replying is a remote user, deliver
				if (note.replyId) {
					const subquery = Notes.createQueryBuilder()
						.select('"userId"')
						.where('"id" = :replyId', { replyId: note.replyId });
					const u = await Users.createQueryBuilder()
						.where('"id" IN (' + subquery.getQuery() + ')')
						.setParameters(subquery.getParameters())
						.andWhere('host IS NOT NULL')
						.getOne();
					if (u != null) dm.addDirectRecipe(u);
				}

				// If the post is a Renote and the poster is a local user and the poster of the original Renote post is a remote user, deliver
				if (note.renoteId) {
					const subquery = Notes.createQueryBuilder()
						.select('"userId"')
						.where('"id" = :renoteId', { renoteId: note.renoteId });
					const u = await Users.createQueryBuilder()
						.where('"id" IN (' + subquery.getQuery() + ')')
						.setParameters(subquery.getParameters())
						.andWhere('host IS NOT NULL')
						.getOne();
					if (u != null) dm.addDirectRecipe(u);
				}

				// Deliver to followers
				if (['public', 'home', 'followers'].includes(note.visibility)) {
					dm.addFollowersRecipe();
				}

				if (['public'].includes(note.visibility)) {
					deliverToRelays(user, noteActivity);
				}

				dm.execute();
			})();
		}
		//#endregion
	} else if (!created) {
		// updating a note does not change its un-/read status
		// updating does not trigger notifications for replied to or renoted notes
		// updating does not trigger notifications for mentioned users (since mentions cannot be changed)

		// TODO publish to streaming API
		publishNoteStream(note.id, 'updated', { note });

		const nm = new NotificationManager(user, note);
		notifyWatchers(note.id, user, nm, 'update');
		await nm.deliver();

		// TODO AP deliver
	}

	// Register to search database
	index(note);
}

async function notifyWatchers(noteId: Note['id'], user: { id: User['id']; }, nm: NotificationManager, type: NotificationType): Promise<void> {
	const watchers = await NoteWatchings.findBy({
		noteId,
		userId: Not(user.id),
	});

	for (const watcher of watchers) {
		nm.push(watcher.userId, type);
	}
}

async function createMentionedEvents(mentionedUsers: User[], note: Note, nm: NotificationManager): Promise<void> {
	for (const u of mentionedUsers.filter(u => Users.isLocalUser(u))) {
		const threadMuted = await NoteThreadMutings.countBy({
			userId: u.id,
			threadId: note.threadId || note.id,
		});

		if (threadMuted) {
			continue;
		}

		// note with "specified" visibility might not be visible to mentioned users
		try {
			const detailPackedNote = await Notes.pack(note, u, {
				detail: true,
			});

			publishMainStream(u.id, 'mention', detailPackedNote);

			const webhooks = (await getActiveWebhooks()).filter(x => x.userId === u.id && x.on.includes('mention'));
			for (const webhook of webhooks) {
				webhookDeliver(webhook, 'mention', {
					note: detailPackedNote,
				});
			}
		} catch (err) {
			if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') continue;
			throw err;
		}

		// Create notification
		nm.push(u.id, 'mention');
	}
}

async function extractFromMfm(user: { host: User['host']; }, note: Note): Promise<{ mentionedUsers: User[], tags: string[] }> {
	const tokens = mfm.parse(note.text ?? '').concat(mfm.parse(note.cw ?? ''));

	const tags = extractHashtags(tokens);

	if (tokens.length === 0) {
		return {
			mentionedUsers: [],
			tags,
		};
	}

	const mentions = extractMentions(tokens);

	let mentionedUsers = (await Promise.all(mentions.map(m =>
		resolveUser(m.username, m.host || user.host).catch(() => null),
	))).filter(x => x != null) as User[];

	// Drop duplicate users
	mentionedUsers = mentionedUsers.filter((u, i, self) =>
		i === self.findIndex(u2 => u.id === u2.id),
	);

	return {
		mentionedUsers,
		tags,
	};
}
