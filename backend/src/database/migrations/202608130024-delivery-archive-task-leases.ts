import type { MigrationInterface, QueryRunner } from "typeorm";

export class DeliveryArchiveTaskLeases2026081300024
  implements MigrationInterface
{
  name = "DeliveryArchiveTaskLeases2026081300024";
  timestamp = 2_026_081_300_024;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_archive_tasks"
      ADD COLUMN "attempt_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN "lease_token" varchar(64),
      ADD COLUMN "lease_owner" varchar(128),
      ADD COLUMN "lease_until" timestamptz
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_delivery_archive_tasks_claim"
      ON "delivery_archive_tasks" ("status", "lease_until", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_delivery_archive_tasks_claim"`,
    );
    await queryRunner.query(`
      ALTER TABLE "delivery_archive_tasks"
      DROP COLUMN IF EXISTS "lease_until",
      DROP COLUMN IF EXISTS "lease_owner",
      DROP COLUMN IF EXISTS "lease_token",
      DROP COLUMN IF EXISTS "attempt_count"
    `);
  }
}
