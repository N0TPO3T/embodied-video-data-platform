import type { MigrationInterface, QueryRunner } from "typeorm";

export class DeliveryPackages2026081300006 implements MigrationInterface {
  name = "DeliveryPackages2026081300006";
  timestamp = 2_026_081_300_006;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "delivery_packages" (
        "id" varchar(64) PRIMARY KEY,
        "name" varchar(160) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'ready',
        "asset_count" integer NOT NULL,
        "total_size_bytes" bigint NOT NULL,
        "created_by_account_id" varchar(64) NOT NULL,
        "created_by_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_delivery_packages_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_delivery_packages_status" CHECK ("status" IN ('ready')),
        CONSTRAINT "chk_delivery_packages_asset_count" CHECK ("asset_count" > 0),
        CONSTRAINT "chk_delivery_packages_total_size" CHECK ("total_size_bytes" >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_delivery_packages_created_at" ON "delivery_packages" ("created_at" DESC)',
    );
    await queryRunner.query(`
      CREATE TABLE "delivery_package_items" (
        "id" varchar(64) PRIMARY KEY,
        "package_id" varchar(64) NOT NULL,
        "point_cycle_item_id" varchar(64) NOT NULL,
        "submission_id" varchar(64) NOT NULL,
        "file_name" varchar(255) NOT NULL,
        "object_key" text NOT NULL,
        "owner_name" varchar(120) NOT NULL,
        "team_name" varchar(120) NOT NULL,
        "final_score" numeric(6,1) NOT NULL,
        "points" numeric(18,2) NOT NULL,
        "size_bytes" bigint NOT NULL,
        CONSTRAINT "fk_delivery_package_items_package" FOREIGN KEY ("package_id")
          REFERENCES "delivery_packages"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_delivery_package_items_point_item" FOREIGN KEY ("point_cycle_item_id")
          REFERENCES "point_cycle_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_delivery_package_items_submission" FOREIGN KEY ("submission_id")
          REFERENCES "submissions"("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_delivery_package_items_submission" UNIQUE ("submission_id"),
        CONSTRAINT "uq_delivery_package_items_point_item" UNIQUE ("point_cycle_item_id"),
        CONSTRAINT "chk_delivery_package_items_score"
          CHECK ("final_score" >= 0 AND "final_score" <= 100),
        CONSTRAINT "chk_delivery_package_items_points" CHECK ("points" >= 0),
        CONSTRAINT "chk_delivery_package_items_size" CHECK ("size_bytes" >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_delivery_package_items_package" ON "delivery_package_items" ("package_id")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "delivery_package_items"');
    await queryRunner.query('DROP TABLE IF EXISTS "delivery_packages"');
  }
}
