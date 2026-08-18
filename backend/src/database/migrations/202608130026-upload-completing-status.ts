import type { MigrationInterface, QueryRunner } from "typeorm";

export class UploadCompletingStatus2026081300026 implements MigrationInterface {
  name = "UploadCompletingStatus2026081300026";
  timestamp = 2_026_081_300_026;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "submissions"
      DROP CONSTRAINT IF EXISTS "chk_submissions_upload_status",
      ADD CONSTRAINT "chk_submissions_upload_status"
        CHECK ("upload_status" IN ('created', 'uploading', 'completing', 'uploaded', 'aborted'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "submissions"
      SET "upload_status" = 'uploading'
      WHERE "upload_status" = 'completing'
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions"
      DROP CONSTRAINT IF EXISTS "chk_submissions_upload_status",
      ADD CONSTRAINT "chk_submissions_upload_status"
        CHECK ("upload_status" IN ('created', 'uploading', 'uploaded', 'aborted'))
    `);
  }
}
