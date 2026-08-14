import type { MigrationInterface, QueryRunner } from "typeorm";

export class DeliveryArchiveTasks2026081300020 implements MigrationInterface {
  name = "DeliveryArchiveTasks2026081300020";
  timestamp = 2_026_081_300_020;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "delivery_archive_tasks" (
        "id" varchar(64) PRIMARY KEY,
        "package_id" varchar(64) NOT NULL,
        "format" varchar(8) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'queued',
        "asset_count" integer NOT NULL,
        "processed_asset_count" integer NOT NULL DEFAULT 0,
        "total_size_bytes" bigint NOT NULL,
        "processed_size_bytes" bigint NOT NULL DEFAULT 0,
        "archive_object_key" text,
        "archive_size_bytes" bigint,
        "file_name" varchar(255) NOT NULL,
        "failure_message" text,
        "requested_by_account_id" varchar(64) NOT NULL,
        "requested_by_name" varchar(120) NOT NULL,
        "started_at" timestamptz,
        "finished_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_delivery_archive_tasks_format" CHECK ("format" IN ('zip', 'tar')),
        CONSTRAINT "chk_delivery_archive_tasks_status" CHECK ("status" IN ('queued', 'processing', 'completed', 'failed')),
        CONSTRAINT "fk_delivery_archive_tasks_package" FOREIGN KEY ("package_id") REFERENCES "delivery_packages"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_delivery_archive_tasks_requested_by" FOREIGN KEY ("requested_by_account_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_delivery_archive_tasks_package_created"
      ON "delivery_archive_tasks" ("package_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_delivery_archive_tasks_status"
      ON "delivery_archive_tasks" ("status")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "delivery_archive_tasks"`);
  }
}
