import type { MigrationInterface, QueryRunner } from "typeorm";

export class PointCycleAdjustments2026081300007
  implements MigrationInterface
{
  name = "PointCycleAdjustments2026081300007";
  timestamp = 2_026_081_300_007;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "point_cycle_adjustments" (
        "id" varchar(64) PRIMARY KEY,
        "point_cycle_item_id" varchar(64) NOT NULL,
        "submission_id" varchar(64) NOT NULL,
        "previous_final_score" numeric(6,1) NOT NULL,
        "next_final_score" numeric(6,1) NOT NULL,
        "previous_settlement_ratio" numeric(6,4) NOT NULL,
        "next_settlement_ratio" numeric(6,4) NOT NULL,
        "previous_invalid_duration_ms" bigint NOT NULL,
        "next_invalid_duration_ms" bigint NOT NULL,
        "previous_effective_duration_ms" bigint NOT NULL,
        "next_effective_duration_ms" bigint NOT NULL,
        "previous_points" numeric(18,2) NOT NULL,
        "next_points" numeric(18,2) NOT NULL,
        "points_delta" numeric(18,2) NOT NULL,
        "reason" text NOT NULL,
        "created_by_account_id" varchar(64) NOT NULL,
        "created_by_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_point_cycle_adjustments_item" FOREIGN KEY ("point_cycle_item_id")
          REFERENCES "point_cycle_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_point_cycle_adjustments_submission" FOREIGN KEY ("submission_id")
          REFERENCES "submissions"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_point_cycle_adjustments_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_point_cycle_adjustments_previous_score"
          CHECK ("previous_final_score" >= 0 AND "previous_final_score" <= 100),
        CONSTRAINT "chk_point_cycle_adjustments_next_score"
          CHECK ("next_final_score" >= 0 AND "next_final_score" <= 100),
        CONSTRAINT "chk_point_cycle_adjustments_previous_ratio"
          CHECK ("previous_settlement_ratio" >= 0 AND "previous_settlement_ratio" <= 1),
        CONSTRAINT "chk_point_cycle_adjustments_next_ratio"
          CHECK ("next_settlement_ratio" >= 0 AND "next_settlement_ratio" <= 1),
        CONSTRAINT "chk_point_cycle_adjustments_previous_invalid_duration"
          CHECK ("previous_invalid_duration_ms" >= 0),
        CONSTRAINT "chk_point_cycle_adjustments_next_invalid_duration"
          CHECK ("next_invalid_duration_ms" >= 0),
        CONSTRAINT "chk_point_cycle_adjustments_previous_effective_duration"
          CHECK ("previous_effective_duration_ms" >= 0),
        CONSTRAINT "chk_point_cycle_adjustments_next_effective_duration"
          CHECK ("next_effective_duration_ms" >= 0),
        CONSTRAINT "chk_point_cycle_adjustments_previous_points"
          CHECK ("previous_points" >= 0),
        CONSTRAINT "chk_point_cycle_adjustments_next_points"
          CHECK ("next_points" >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_point_cycle_adjustments_item" ON "point_cycle_adjustments" ("point_cycle_item_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_point_cycle_adjustments_submission" ON "point_cycle_adjustments" ("submission_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_point_cycle_adjustments_created_at" ON "point_cycle_adjustments" ("created_at" DESC)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "point_cycle_adjustments"');
  }
}
