import json from 'koa-json-body';
import Router from '@koa/router';
import { In, IsNull, Not } from 'typeorm';
import httpSignature from '@peertube/http-signature';

import { renderActivity } from '@/remote/activitypub/renderer/index.js';
import renderNote from '@/remote/activitypub/renderer/note.js';
import renderKey from '@/remote/activitypub/renderer/key.js';
import { renderPerson } from '@/remote/activitypub/renderer/person.js';
import renderEmoji from '@/remote/activitypub/renderer/emoji.js';
import { inbox as processInbox } from '@/queue/index.js';
import { isSelfHost } from '@/misc/convert-host.js';
import { Notes, Users, Emojis, NoteReactions } from '@/models/index.js';
import { ILocalUser, User } from '@/models/entities/user.js';
import { renderLike } from '@/remote/activitypub/renderer/like.js';
import { getUserKeypair } from '@/misc/keypair-store.js';
import renderFollow from '@/remote/activitypub/renderer/follow.js';
import { renderNoteOrRenoteActivity } from '@/remote/activitypub/renderer/note-or-renote.js';
import Outbox from './activitypub/outbox.js';
import Followers from './activitypub/followers.js';
import Following from './activitypub/following.js';
import Featured from './activitypub/featured.js';
import { SignatureValidationResult, validateFetchSignature } from './activitypub/fetch-signature.js';
import { isInstanceActor } from '@/services/instance-actor.js';

// Init router
const router = new Router();

function inbox(ctx: Router.RouterContext): void {
	let signature;

	try {
		signature = httpSignature.parseRequest(ctx.req);
	} catch (e) {
		ctx.status = 401;
		return;
	}

	processInbox(ctx.request.body, signature);

	ctx.status = 202;
}

const ACTIVITY_JSON = 'application/activity+json; charset=utf-8';
const LD_JSON = 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"; charset=utf-8';

function isActivityPubReq(ctx: Router.RouterContext): boolean {
	ctx.response.vary('Accept');
	// if no accept header is supplied, koa returns the 1st, so html is used as a dummy
	// i.e. activitypub requests must be explicit
	const accepted = ctx.accepts('html', ACTIVITY_JSON, LD_JSON);
	return typeof accepted === 'string' && !accepted.match(/html/);
}

export function setResponseType(ctx: Router.RouterContext): void {
	const accept = ctx.accepts(ACTIVITY_JSON, LD_JSON);
	if (accept === LD_JSON) {
		ctx.response.type = LD_JSON;
	} else {
		ctx.response.type = ACTIVITY_JSON;
	}
}

async function handleSignature(ctx: Router.RouterContext): Promise<boolean> {
	const result = await validateFetchSignature(ctx.req);
	switch (result) {
		// Fetch signature verification is disabled.
		case 'always':
			ctx.set('Cache-Control', 'public, max-age=180');
			return true;
		// Fetch signature verification succeeded.
		case 'valid':
			ctx.set('Cache-Control', 'no-store');
			return true;
		case 'missing':
		case 'invalid':
			// This would leak information on blocks. Only use for debugging.
			// ctx.status = 400;
			// break;
		// eslint-disable-next-line no-fallthrough
		case 'rejected':
		default:
			ctx.status = 403;
			break;
	}

	ctx.set('Cache-Control', 'no-store');
	return false;
}

// inbox
router.post('/inbox', json(), inbox);
router.post('/users/:user/inbox', json(), inbox);

// note
router.get('/notes/:note', async (ctx, next) => {
	if (!isActivityPubReq(ctx)) return await next();
	if (!(await handleSignature(ctx))) return;

	const note = await Notes.findOneBy({
		id: ctx.params.note,
		visibility: In(['public' as const, 'home' as const]),
		localOnly: false,
	});

	if (note == null) {
		ctx.status = 404;
		return;
	}

	// redirect if remote
	if (note.userHost != null) {
		if (note.uri == null || isSelfHost(note.userHost)) {
			ctx.status = 500;
			return;
		}
		ctx.redirect(note.uri);
		return;
	}

	ctx.body = renderActivity(await renderNote(note, false));
	setResponseType(ctx);
});

// note activity
router.get('/notes/:note/activity', async ctx => {
	if (!isActivityPubReq(ctx)) {
		/*
		Redirect to the human readable page. in this case using next is not possible,
		since there is no human readable page explicitly for the activity.
		*/
		ctx.redirect(`/notes/${ctx.params.note}`);
		return;
	}
	if (!(await handleSignature(ctx))) return;

	const note = await Notes.findOneBy({
		id: ctx.params.note,
		userHost: IsNull(),
		visibility: In(['public' as const, 'home' as const]),
		localOnly: false,
	});

	if (note == null) {
		ctx.status = 404;
		return;
	}

	ctx.body = renderActivity(await renderNoteOrRenoteActivity(note));
	setResponseType(ctx);
});

// outbox
router.get('/users/:user/outbox', async ctx => {
	if (!(await handleSignature(ctx))) return;
	return await Outbox(ctx);
});

// followers
router.get('/users/:user/followers', async ctx => {
	if (!(await handleSignature(ctx))) return;
	return await Followers(ctx);
});

// following
router.get('/users/:user/following', async ctx => {
	if (!(await handleSignature(ctx))) return;
	return await Following(ctx);
});

// featured
router.get('/users/:user/collections/featured', async ctx => {
	if (!(await handleSignature(ctx))) return;
	return await Featured(ctx);
});

// publickey
router.get('/users/:user/publickey', async ctx => {
	const userId = ctx.params.user;

	const user = await Users.findOneBy({
		id: userId,
		host: IsNull(),
	});

	if (user == null) {
		ctx.status = 404;
		return;
	}

	const keypair = await getUserKeypair(user.id);

	if (Users.isLocalUser(user)) {
		ctx.body = renderActivity(renderKey(user, keypair));
		ctx.set('Cache-Control', 'public, max-age=180');
		setResponseType(ctx);
	} else {
		ctx.status = 400;
	}
});

// user
async function userInfo(ctx: Router.RouterContext, user: User | null): Promise<void> {
	if (user == null) {
		ctx.status = 404;
		return;
	}

	ctx.body = renderActivity(await renderPerson(user as ILocalUser));
	setResponseType(ctx);
}

router.get('/users/:user', async (ctx, next) => {
	if (!isActivityPubReq(ctx)) return await next();

	const userId = ctx.params.user;

	const user = await Users.findOneBy({
		id: userId,
		host: IsNull(),
		isSuspended: false,
	});

	// Allow fetching the instance actor without any HTTP signature.
	// Only on this route, as it is the canonical route.
	// If the user could not be resolved, or is not the instance actor,
	// validate and enforce signatures.
	if (user == null || !isInstanceActor(user))
	{
		if (!(await handleSignature(ctx))) return;
	}
	else if (isInstanceActor(user))
	{
		// Set cache at all times for instance actors.
		ctx.set('Cache-Control', 'public, max-age=180');
	}

	await userInfo(ctx, user);
});

router.get('/@:user', async (ctx, next) => {
	if (!isActivityPubReq(ctx)) return await next();
	if (!(await handleSignature(ctx))) return;

	const user = await Users.findOneBy({
		usernameLower: ctx.params.user.toLowerCase(),
		host: IsNull(),
		isSuspended: false,
	});

	await userInfo(ctx, user);
});

// emoji
router.get('/emojis/:emoji', async ctx => {
	// Enforcing HTTP signatures on Emoji objects could cause problems for
	// other software that might use those objects for copying custom emoji.

	const emoji = await Emojis.findOneBy({
		host: IsNull(),
		name: ctx.params.emoji,
	});

	if (emoji == null) {
		ctx.status = 404;
		return;
	}

	ctx.body = renderActivity(await renderEmoji(emoji));
	ctx.set('Cache-Control', 'public, max-age=180');
	setResponseType(ctx);
});

// like
router.get('/likes/:like', async ctx => {
	if (!(await handleSignature(ctx))) return;
	const reaction = await NoteReactions.findOneBy({ id: ctx.params.like });

	if (reaction == null) {
		ctx.status = 404;
		return;
	}

	const note = await Notes.findOneBy({
		id: reaction.noteId,
		visibility: In(['public' as const, 'home' as const]),
	});

	if (note == null) {
		ctx.status = 404;
		return;
	}

	ctx.body = renderActivity(await renderLike(reaction, note));
	setResponseType(ctx);
});

// follow
router.get('/follows/:follower/:followee', async ctx => {
	if (!(await handleSignature(ctx))) return;
	// This may be used before the follow is completed, so we do not
	// check if the following exists.

	const [follower, followee] = await Promise.all([
		Users.findOneBy({
			id: ctx.params.follower,
			host: IsNull(),
		}),
		Users.findOneBy({
			id: ctx.params.followee,
			host: Not(IsNull()),
		}),
	]);

	if (follower == null || followee == null) {
		ctx.status = 404;
		return;
	}

	ctx.body = renderActivity(renderFollow(follower, followee));
	setResponseType(ctx);
});

export default router;
