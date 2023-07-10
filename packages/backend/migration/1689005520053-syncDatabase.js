export class syncDatabase1689005520053 {
	name = 'syncDatabase1689005520053';

	async up(queryRunner) {
		await queryRunner.query(`COMMENT ON COLUMN "user"."isDeleted" IS 'How many delivery jobs are outstanding before the deletion is completed.'`);
		await queryRunner.query(`ALTER TYPE "public"."note_thread_muting_mutingnotificationtypes_enum" RENAME TO "note_thread_muting_mutingnotificationtypes_enum_old"`);
		await queryRunner.query(`CREATE TYPE "public"."note_thread_muting_mutingnotificationtypes_enum" AS ENUM('mention', 'reply', 'renote', 'quote', 'reaction', 'pollVote', 'pollEnded', 'update')`);
		await queryRunner.query(`ALTER TABLE "note_thread_muting" ALTER COLUMN "mutingNotificationTypes" DROP DEFAULT`);
		await queryRunner.query(`ALTER TABLE "note_thread_muting" ALTER COLUMN "mutingNotificationTypes" TYPE "public"."note_thread_muting_mutingnotificationtypes_enum"[] USING "mutingNotificationTypes"::"text"::"public"."note_thread_muting_mutingnotificationtypes_enum"[]`);
		await queryRunner.query(`ALTER TABLE "note_thread_muting" ALTER COLUMN "mutingNotificationTypes" SET DEFAULT '{}'`);
		await queryRunner.query(`DROP TYPE "public"."note_thread_muting_mutingnotificationtypes_enum_old"`);
		await queryRunner.query(`ALTER TYPE "public"."notification_type_enum" RENAME TO "notification_type_enum_old"`);
		await queryRunner.query(`CREATE TYPE "public"."notification_type_enum" AS ENUM('follow', 'mention', 'reply', 'renote', 'quote', 'reaction', 'pollVote', 'pollEnded', 'update', 'receiveFollowRequest', 'followRequestAccepted', 'groupInvited', 'move', 'app')`);
		await queryRunner.query(`ALTER TABLE "notification" ALTER COLUMN "type" TYPE "public"."notification_type_enum" USING "type"::"text"::"public"."notification_type_enum"`);
		await queryRunner.query(`DROP TYPE "public"."notification_type_enum_old"`);
		await queryRunner.query(`ALTER TYPE "public"."user_profile_mutingnotificationtypes_enum" RENAME TO "user_profile_mutingnotificationtypes_enum_old"`);
		await queryRunner.query(`CREATE TYPE "public"."user_profile_mutingnotificationtypes_enum" AS ENUM('follow', 'mention', 'reply', 'renote', 'quote', 'reaction', 'pollVote', 'pollEnded', 'update', 'receiveFollowRequest', 'followRequestAccepted', 'groupInvited', 'move', 'app')`);
		await queryRunner.query(`ALTER TABLE "user_profile" ALTER COLUMN "mutingNotificationTypes" DROP DEFAULT`);
		await queryRunner.query(`ALTER TABLE "user_profile" ALTER COLUMN "mutingNotificationTypes" TYPE "public"."user_profile_mutingnotificationtypes_enum"[] USING "mutingNotificationTypes"::"text"::"public"."user_profile_mutingnotificationtypes_enum"[]`);
		await queryRunner.query(`ALTER TABLE "user_profile" ALTER COLUMN "mutingNotificationTypes" SET DEFAULT '{}'`);
		await queryRunner.query(`DROP TYPE "public"."user_profile_mutingnotificationtypes_enum_old"`);
	}

	async down(queryRunner) {
		await queryRunner.query(`CREATE TYPE "public"."user_profile_mutingnotificationtypes_enum_old" AS ENUM('follow', 'mention', 'reply', 'renote', 'quote', 'reaction', 'pollVote', 'pollEnded', 'receiveFollowRequest', 'followRequestAccepted', 'groupInvited', 'move', 'app', 'updated')`);
		await queryRunner.query(`ALTER TABLE "user_profile" ALTER COLUMN "mutingNotificationTypes" DROP DEFAULT`);
		await queryRunner.query(`ALTER TABLE "user_profile" ALTER COLUMN "mutingNotificationTypes" TYPE "public"."user_profile_mutingnotificationtypes_enum_old"[] USING "mutingNotificationTypes"::"text"::"public"."user_profile_mutingnotificationtypes_enum_old"[]`);
		await queryRunner.query(`ALTER TABLE "user_profile" ALTER COLUMN "mutingNotificationTypes" SET DEFAULT '{}'`);
		await queryRunner.query(`DROP TYPE "public"."user_profile_mutingnotificationtypes_enum"`);
		await queryRunner.query(`ALTER TYPE "public"."user_profile_mutingnotificationtypes_enum_old" RENAME TO "user_profile_mutingnotificationtypes_enum"`);
		await queryRunner.query(`CREATE TYPE "public"."notification_type_enum_old" AS ENUM('follow', 'mention', 'reply', 'renote', 'quote', 'reaction', 'pollVote', 'pollEnded', 'receiveFollowRequest', 'followRequestAccepted', 'groupInvited', 'move', 'app', 'updated')`);
		await queryRunner.query(`ALTER TABLE "notification" ALTER COLUMN "type" TYPE "public"."notification_type_enum_old" USING "type"::"text"::"public"."notification_type_enum_old"`);
		await queryRunner.query(`DROP TYPE "public"."notification_type_enum"`);
		await queryRunner.query(`ALTER TYPE "public"."notification_type_enum_old" RENAME TO "notification_type_enum"`);
		await queryRunner.query(`CREATE TYPE "public"."note_thread_muting_mutingnotificationtypes_enum_old" AS ENUM('mention', 'reply', 'renote', 'quote', 'reaction', 'pollVote', 'pollEnded')`);
		await queryRunner.query(`ALTER TABLE "note_thread_muting" ALTER COLUMN "mutingNotificationTypes" DROP DEFAULT`);
		await queryRunner.query(`ALTER TABLE "note_thread_muting" ALTER COLUMN "mutingNotificationTypes" TYPE "public"."note_thread_muting_mutingnotificationtypes_enum_old"[] USING "mutingNotificationTypes"::"text"::"public"."note_thread_muting_mutingnotificationtypes_enum_old"[]`);
		await queryRunner.query(`ALTER TABLE "note_thread_muting" ALTER COLUMN "mutingNotificationTypes" SET DEFAULT '{}'`);
		await queryRunner.query(`DROP TYPE "public"."note_thread_muting_mutingnotificationtypes_enum"`);
		await queryRunner.query(`ALTER TYPE "public"."note_thread_muting_mutingnotificationtypes_enum_old" RENAME TO "note_thread_muting_mutingnotificationtypes_enum"`);
		await queryRunner.query(`COMMENT ON COLUMN "user"."isDeleted" IS NULL`);
	}
}
