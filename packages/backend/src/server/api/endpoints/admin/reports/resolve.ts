import { AbuseUserReports, Users } from '@/models/index.js';
import { getInstanceActor } from '@/services/instance-actor.js';
import { deliver } from '@/queue/index.js';
import { renderActivity } from '@/remote/activitypub/renderer/index.js';
import { renderFlag } from '@/remote/activitypub/renderer/flag.js';
import define from '@/server/api/define.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		reportId: { type: 'string', format: 'misskey:id' },
		forward: { type: 'boolean', default: false },
	},
	required: ['reportId'],
} as const;

// eslint-disable-next-line import/no-default-export
export default define(meta, paramDef, async (ps, me) => {
	const report = await AbuseUserReports.findOneByOrFail({ id: ps.reportId });

	if (ps.forward && report.targetUserHost != null) {
		const actor = await getInstanceActor();
		const targetUser = await Users.findOneByOrFail({ id: report.targetUserId });

		deliver(renderActivity(renderFlag(actor, report)), targetUser.inbox);
	}

	await AbuseUserReports.update(report.id, {
		resolved: true,
		assigneeId: me.id,
		forwarded: ps.forward && report.targetUserHost != null,
	});
});
