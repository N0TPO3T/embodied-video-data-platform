import type { MigrationInterface, QueryRunner } from "typeorm";

export class SubmissionStorageRecovery2026081300025
  implements MigrationInterface
{
  name = "SubmissionStorageRecovery2026081300025";
  timestamp = 2_026_081_300_025;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "submissions"
      DROP CONSTRAINT IF EXISTS "chk_submissions_storage_status",
      ADD COLUMN "multipart_completion_parts" jsonb,
      ADD COLUMN "storage_delete_mode" varchar(24),
      ADD COLUMN "storage_delete_object_keys" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN "storage_delete_force" boolean NOT NULL DEFAULT false,
      ADD CONSTRAINT "chk_submissions_storage_status"
        CHECK ("storage_status" IN ('available', 'delete_pending', 'deleted')),
      ADD CONSTRAINT "chk_submissions_storage_delete_mode"
        CHECK ("storage_delete_mode" IS NULL OR "storage_delete_mode" IN ('objects', 'submission'))
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_submissions_storage_recovery"
      ON "submissions" ("storage_status", "upload_status", "updated_at")
      WHERE "storage_status" = 'delete_pending' OR "upload_status" = 'completing'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_submissions_storage_recovery"',
    );
    await queryRunner.query(`
      ALTER TABLE "submissions"
      DROP CONSTRAINT IF EXISTS "chk_submissions_storage_delete_mode",
      DROP CONSTRAINT IF EXISTS "chk_submissions_storage_status",
      DROP COLUMN IF EXISTS "storage_delete_force",
      DROP COLUMN IF EXISTS "storage_delete_object_keys",
      DROP COLUMN IF EXISTS "storage_delete_mode",
      DROP COLUMN IF EXISTS "multipart_completion_parts",
      ADD CONSTRAINT "chk_submissions_storage_status"
        CHECK ("storage_status" IN ('available', 'deleted'))
    `);
  }
}
