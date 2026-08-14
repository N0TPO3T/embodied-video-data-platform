import type { MigrationInterface, QueryRunner } from "typeorm";

export class PointCycles2026081300005 implements MigrationInterface {
  name = "PointCycles2026081300005";
  timestamp = 2_026_081_300_005;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "point_cycles" (
        "id" varchar(64) PRIMARY KEY,
        "business_date" date NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'locked',
        "submission_count" integer NOT NULL,
        "effective_duration_ms" bigint NOT NULL,
        "total_points" numeric(18,2) NOT NULL,
        "created_by_account_id" varchar(64) NOT NULL,
        "created_by_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_point_cycles_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_point_cycles_status" CHECK ("status" IN ('locked')),
        CONSTRAINT "chk_point_cycles_submission_count" CHECK ("submission_count" > 0),
        CONSTRAINT "chk_point_cycles_effective_duration" CHECK ("effective_duration_ms" >= 0),
        CONSTRAINT "chk_point_cycles_total_points" CHECK ("total_points" >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_point_cycles_business_date" ON "point_cycles" ("business_date" DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_point_cycles_created_at" ON "point_cycles" ("created_at" DESC)',
    );

    await queryRunner.query(`
      CREATE TABLE "point_cycle_items" (
        "id" varchar(64) PRIMARY KEY,
        "cycle_id" varchar(64) NOT NULL,
        "submission_id" varchar(64) NOT NULL,
        "owner_id" varchar(64) NOT NULL,
        "owner_name" varchar(120) NOT NULL,
        "team_id" varchar(64) NOT NULL,
        "team_name" varchar(120) NOT NULL,
        "file_name" varchar(255) NOT NULL,
        "final_score" numeric(6,1) NOT NULL,
        "settlement_ratio" numeric(6,4) NOT NULL,
        "effective_duration_ms" bigint NOT NULL,
        "points_per_minute" numeric(12,4) NOT NULL,
        "points" numeric(18,2) NOT NULL,
        "quality_revision" integer NOT NULL,
        "quality_reviewed_at" timestamptz,
        CONSTRAINT "fk_point_cycle_items_cycle" FOREIGN KEY ("cycle_id")
          REFERENCES "point_cycles"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_point_cycle_items_submission" FOREIGN KEY ("submission_id")
          REFERENCES "submissions"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_point_cycle_items_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_point_cycle_items_team" FOREIGN KEY ("team_id")
          REFERENCES "teams"("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_point_cycle_items_submission" UNIQUE ("submission_id"),
        CONSTRAINT "chk_point_cycle_items_score"
          CHECK ("final_score" >= 0 AND "final_score" <= 100),
        CONSTRAINT "chk_point_cycle_items_ratio"
          CHECK ("settlement_ratio" >= 0 AND "settlement_ratio" <= 1),
        CONSTRAINT "chk_point_cycle_items_effective_duration"
          CHECK ("effective_duration_ms" >= 0),
        CONSTRAINT "chk_point_cycle_items_points_per_minute"
          CHECK ("points_per_minute" >= 0),
        CONSTRAINT "chk_point_cycle_items_points" CHECK ("points" >= 0),
        CONSTRAINT "chk_point_cycle_items_quality_revision"
          CHECK ("quality_revision" >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_point_cycle_items_cycle" ON "point_cycle_items" ("cycle_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_point_cycle_items_owner" ON "point_cycle_items" ("owner_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_point_cycle_items_team" ON "point_cycle_items" ("team_id")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "point_cycle_items"');
    await queryRunner.query('DROP TABLE IF EXISTS "point_cycles"');
  }
}
