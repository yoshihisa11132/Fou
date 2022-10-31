import config from '../built/config/index.js';

export class remoteThreadIds1667212446191 {
	name = 'remoteThreadIds1667212446191';

	async up(queryRunner) {
		await Promise.all([
			queryRunner.query(`UPDATE "note" SET "threadId" = '${config.url}/notes/' + "threadId"`),
			queryRunner.query(`UPDATE "note_thread_muting" SET "threadId" = '${config.url}/notes/' + "threadId"`),
		]);
	}

	async down() {
		// cannot be undone:
		// after this migration other instances threadIds may be stored in the database
	}
}
