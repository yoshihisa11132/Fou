import * as mfm from 'mfm-js';
import { db } from '@/db/postgre.js';
import { resolveUser } from '@/remote/resolve-user.js';
import { concat } from '@/prelude/array.js';
import { extractMentions } from '@/misc/extract-mentions.js';
import { extractCustomEmojisFromMfm } from '@/misc/extract-custom-emojis-from-mfm.js';
import { extractHashtags } from '@/misc/extract-hashtags.js';
import { Note } from '@/models/entities/note.js';
import { Users, Channels } from '@/models/index.js';
import { DriveFile } from '@/models/entities/drive-file.js';
import { App } from '@/models/entities/app.js';
import { User } from '@/models/entities/user.js';
import { genId } from '@/misc/gen-id.js';
import { Poll, IPoll } from '@/models/entities/poll.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { Channel } from '@/models/entities/channel.js';
import { normalizeForSearch } from '@/misc/normalize-for-search.js';
import { sideEffects } from './side-effects.js';

type MinimumUser = {
	id: User['id'];
	host: User['host'];
	username: User['username'];
	uri: User['uri'];
};

type Option = {
	createdAt?: Date | null;
	updatedAt?: Date | null;
	name?: string | null;
	text?: string | null;
	reply?: Note | null;
	renote?: Note | null;
	files?: DriveFile[] | null;
	poll?: IPoll | null;
	localOnly?: boolean | null;
	cw?: string | null;
	visibility?: 'home' | 'public' | 'followers' | 'specified';
	visibleUsers?: MinimumUser[] | null;
	channel?: Channel | null;
	apMentions?: MinimumUser[] | null;
	apHashtags?: string[] | null;
	apEmojis?: string[] | null;
	uri?: string | null;
	url?: string | null;
	app?: App | null;
};

export default async (user: { id: User['id']; username: User['username']; host: User['host']; isSilenced: User['isSilenced']; createdAt: User['createdAt']; }, data: Option, silent = false): Promise<Note> => new Promise<Note>(async (res, rej) => {
	// If you reply outside the channel, adjust to the scope of the target
	// (I think this could be done client-side, but server-side for now)
	if (data.reply && data.channel && data.reply.channelId !== data.channel.id) {
		if (data.reply.channelId) {
			data.channel = await Channels.findOneBy({ id: data.reply.channelId });
		} else {
			data.channel = null;
		}
	}

	// When you reply to a channel, adjust the scope to that of the target.
	// (I think this could be done client-side, but server-side for now)
	if (data.reply?.channelId && (data.channel == null)) {
		data.channel = await Channels.findOneBy({ id: data.reply.channelId });
	}

	if (data.createdAt == null) data.createdAt = new Date();
	if (data.visibility == null) data.visibility = 'public';
	if (data.localOnly == null) data.localOnly = false;
	if (data.channel != null) data.visibility = 'public';
	if (data.channel != null) data.visibleUsers = [];
	if (data.channel != null) data.localOnly = true;

	// silence
	if (user.isSilenced && data.visibility === 'public' && data.channel == null) {
		data.visibility = 'home';
	}

	// Reject if the target of the renote is not Home or Public.
	if (data.renote && data.renote.visibility !== 'public' && data.renote.visibility !== 'home' && data.renote.userId !== user.id) {
		return rej('Renote target is not public or home');
	}

	// If the target of the renote is not public, make it home.
	if (data.renote && data.renote.visibility !== 'public' && data.visibility === 'public') {
		data.visibility = 'home';
	}

	// If the target of Renote is followers, make it followers.
	if (data.renote && data.renote.visibility === 'followers') {
		data.visibility = 'followers';
	}

	// Ff the original note is local-only, make the renote also local-only.
	if (data.renote && data.renote.localOnly && data.channel == null) {
		data.localOnly = true;
	}

	// If you reply to local only, make it local only.
	if (data.reply && data.reply.localOnly && data.channel == null) {
		data.localOnly = true;
	}

	if (data.text) {
		data.text = data.text.trim();
	} else {
		data.text = null;
	}

	let tags = data.apHashtags;
	let emojis = data.apEmojis;
	let mentionedUsers = data.apMentions;

	// Parse MFM if needed
	if (!tags || !emojis || !mentionedUsers) {
		const tokens = data.text ? mfm.parse(data.text) : [];
		const cwTokens = data.cw ? mfm.parse(data.cw) : [];
		const choiceTokens = data.poll?.choices
			? concat(data.poll.choices.map(choice => mfm.parse(choice)))
			: [];

		const combinedTokens = tokens.concat(cwTokens).concat(choiceTokens);

		tags = data.apHashtags || extractHashtags(combinedTokens);

		emojis = data.apEmojis || extractCustomEmojisFromMfm(combinedTokens);

		mentionedUsers = data.apMentions || await extractMentionedUsers(user, combinedTokens);
	}

	tags = tags.filter(tag => Array.from(tag || '').length <= 128).splice(0, 32);

	if (data.reply && (user.id !== data.reply.userId) && !mentionedUsers.some(u => u.id === data.reply?.userId)) {
		mentionedUsers.push(await Users.findOneByOrFail({ id: data.reply.userId }));
	}

	if (data.visibility === 'specified') {
		if (data.visibleUsers == null) throw new Error('invalid param');

		for (const u of data.visibleUsers) {
			if (!mentionedUsers.some(x => x.id === u.id)) {
				mentionedUsers.push(u);
			}
		}

		if (data.reply && !data.visibleUsers.some(x => x.id === data.reply?.userId)) {
			data.visibleUsers.push(await Users.findOneByOrFail({ id: data.reply.userId }));
		}
	}

	const note = await insertNote(user, data, tags, emojis, mentionedUsers);

	res(note);

	sideEffects(user, note, silent, true);
});

async function insertNote(user: { id: User['id']; host: User['host']; }, data: Option, tags: string[], emojis: string[], mentionedUsers: MinimumUser[]): Promise<Note> {
	const createdAt = data.createdAt ?? new Date();

	const insert = new Note({
		id: genId(createdAt),
		createdAt,
		updatedAt: data.updatedAt ?? null,
		fileIds: data.files?.map(file => file.id) ?? [],
		replyId: data.reply?.id ?? null,
		renoteId: data.renote?.id ?? null,
		channelId: data.channel?.id ?? null,
		threadId: data.reply?.threadId ?? data.reply?.id ?? null,
		name: data.name,
		text: data.text,
		hasPoll: data.poll != null,
		cw: data.cw ?? null,
		tags: tags.map(tag => normalizeForSearch(tag)),
		emojis,
		userId: user.id,
		localOnly: data.localOnly ?? false,
		visibility: data.visibility,
		visibleUserIds: data.visibility === 'specified'
			? data.visibleUsers?.map(u => u.id) ?? []
			: [],

		attachedFileTypes: data.files?.map(file => file.type) ?? [],

		// denormalized data below
		replyUserId: data.reply?.userId,
		replyUserHost: data.reply?.userHost,
		renoteUserId: data.renote?.userId,
		renoteUserHost: data.renote?.userHost,
		userHost: user.host,
	});

	if (data.uri != null) insert.uri = data.uri;
	if (data.url != null) insert.url = data.url;

	// Append mentions data
	if (mentionedUsers.length > 0) {
		insert.mentions = mentionedUsers.map(u => u.id);
	}

	// Create a post
	try {
		// Start transaction
		await db.transaction(async transactionalEntityManager => {
			await transactionalEntityManager.insert(Note, insert);

			if (data.poll != null) {
				const poll = new Poll({
					noteId: insert.id,
					choices: data.poll.choices,
					expiresAt: data.poll.expiresAt,
					multiple: data.poll.multiple,
					votes: new Array(data.poll.choices.length).fill(0),
					noteVisibility: insert.visibility,
					userId: user.id,
					userHost: user.host,
				});
				await transactionalEntityManager.insert(Poll, poll);
			}
		});

		return insert;
	} catch (e) {
		// duplicate key error
		if (isDuplicateKeyValueError(e)) {
			const err = new Error('Duplicated note');
			err.name = 'duplicated';
			throw err;
		}

		console.error(e);

		throw e;
	}
}

async function extractMentionedUsers(user: { host: User['host']; }, tokens: mfm.MfmNode[]): Promise<User[]> {
	if (tokens.length === 0) return [];

	const mentions = extractMentions(tokens);

	let mentionedUsers = (await Promise.all(mentions.map(m =>
		resolveUser(m.username, m.host || user.host).catch(() => null),
	))).filter(x => x != null) as User[];

	// Drop duplicate users
	mentionedUsers = mentionedUsers.filter((u, i, self) =>
		i === self.findIndex(u2 => u.id === u2.id),
	);

	return mentionedUsers;
}
