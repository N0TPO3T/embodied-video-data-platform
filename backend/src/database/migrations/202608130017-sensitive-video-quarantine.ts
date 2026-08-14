import type { MigrationInterface, QueryRunner } from "typeorm";

export class SensitiveVideoQuarantine2026081300017
  implements MigrationInterface
{
  name = "SensitiveVideoQuarantine2026081300017";
  timestamp = 2_026_081_300_017;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "submissions"
      ADD COLUMN "asset_status" varchar(24) NOT NULL DEFAULT 'active',
      ADD COLUMN "quarantine_reason" text,
      ADD COLUMN "quarantined_at" timestamptz,
      ADD COLUMN "quarantined_by_account_id" varchar(64),
      ADD COLUMN "quarantined_by_name" varchar(120),
      ADD CONSTRAINT "chk_submissions_asset_status"
        CHECK ("asset_status" IN ('active', 'quarantined'))
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_submissions_asset_status" ON "submissions" ("asset_status")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_submissions_asset_status"',
    );
    await queryRunner.query(`
      ALTER TABLE "submissions"
      DROP CONSTRAINT IF EXISTS "chk_submissions_asset_status",
      DROP COLUMN IF EXISTS "quarantined_by_name",
      DROP COLUMN IF EXISTS "quarantined_by_account_id",
      DROP COLUMN IF EXISTS "quarantined_at",
      DROP COLUMN IF EXISTS "quarantine_reason",
      DROP COLUMN IF EXISTS "asset_status"
    `);
  }
}
