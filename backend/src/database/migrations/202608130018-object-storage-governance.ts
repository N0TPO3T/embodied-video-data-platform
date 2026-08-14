import type { MigrationInterface, QueryRunner } from "typeorm";

export class ObjectStorageGovernance2026081300018
  implements MigrationInterface
{
  name = "ObjectStorageGovernance2026081300018";
  timestamp = 2_026_081_300_018;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "submissions"
      ADD COLUMN "storage_status" varchar(24) NOT NULL DEFAULT 'available',
      ADD COLUMN "storage_retain_until" timestamptz,
      ADD COLUMN "storage_deleted_at" timestamptz,
      ADD COLUMN "storage_deleted_by_account_id" varchar(64),
      ADD COLUMN "storage_deleted_by_name" varchar(120),
      ADD COLUMN "storage_delete_reason" text,
      ADD CONSTRAINT "chk_submissions_storage_status"
        CHECK ("storage_status" IN ('available', 'deleted'))
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_submissions_storage_status" ON "submissions" ("storage_status")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_submissions_storage_status"',
    );
    await queryRunner.query(`
      ALTER TABLE "submissions"
      DROP CONSTRAINT IF EXISTS "chk_submissions_storage_status",
      DROP COLUMN IF EXISTS "storage_delete_reason",
      DROP COLUMN IF EXISTS "storage_deleted_by_name",
      DROP COLUMN IF EXISTS "storage_deleted_by_account_id",
      DROP COLUMN IF EXISTS "storage_deleted_at",
      DROP COLUMN IF EXISTS "storage_retain_until",
      DROP COLUMN IF EXISTS "storage_status"
    `);
  }
}
