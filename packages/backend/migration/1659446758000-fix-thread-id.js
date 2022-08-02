export class fixThreadId1659446758000 {
	name = 'fixThreadId1659446758000'

	async up(queryRunner) {
		await Promise.all([
			queryRunner.query(`UPDATE "note" SET "threadId" = "id" WHERE "replyId" IS NULL`),
			queryRunner.query(`WITH "threads" ("noteId", "thread") AS (
			    SELECT "id" as "noteId", "parent" as "thread" FROM (
			        WITH RECURSIVE "parents" ("id", "parent", "height") AS (
			                SELECT "id", "replyId", 0 FROM "note" WHERE "replyId" IS NOT NULL AND "threadId" IS NULL
			            UNION ALL
			                SELECT "parents"."id", "note"."replyId", "parents"."height" + 1
			                FROM "parents"
			                JOIN "note" ON "parents"."parent" = "note"."id"
			                WHERE "note"."replyId" IS NOT NULL
			        ) SELECT *, MAX("height") OVER (PARTITION BY "id") AS "maxheight" FROM "parents"
			    ) AS "x"
			    WHERE "height" = "maxheight"
			) UPDATE "note" SET "threadId" = "threads"."thread" FROM "threads" WHERE "id" = "threads"."noteId"`),
		]);
		await queryRunner.query(`ALTER TABLE "note" ALTER COLUMN "threadId" SET NOT NULL`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "note" ALTER COLUMN "threaadId" DROP NOT NULL`);
		// Cannot un-fix thread id's for ones that just were not migrated (2nd query above)
		// but can remove the thread ids for the root notes of each thread.
		await queryRunner.query(`UPDATE "note" SET "threadId" = NULL WHERE "replyId" IS NULL`);
	}
}
