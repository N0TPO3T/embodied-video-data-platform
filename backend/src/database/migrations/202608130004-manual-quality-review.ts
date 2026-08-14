import type { MigrationInterface, QueryRunner } from "typeorm";

export class ManualQualityReview2026081300004 implements MigrationInterface {
  name = "ManualQualityReview2026081300004";
  timestamp = 2_026_081_300_004;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "video_quality_results"
        ADD COLUMN "manual_final_score" numeric(6,1),
        ADD COLUMN "manual_settlement_ratio" numeric(6,4),
        ADD COLUMN "manual_invalid_duration_ms" bigint,
        ADD COLUMN "manual_billable_duration_ms" bigint,
        ADD COLUMN "manual_issues" jsonb,
        ADD COLUMN "manual_review_reason" text,
        ADD COLUMN "manual_reviewed_by_account_id" varchar(64),
        ADD COLUMN "manual_reviewed_by_name" varchar(120),
        ADD COLUMN "manual_reviewed_at" timestamptz,
        ADD COLUMN "review_revision" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "video_quality_results"
        ADD CONSTRAINT "fk_video_quality_manual_reviewer"
          FOREIGN KEY ("manual_reviewed_by_account_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "chk_video_quality_manual_score"
          CHECK ("manual_final_score" IS NULL OR ("manual_final_score" >= 0 AND "manual_final_score" <= 100)),
        ADD CONSTRAINT "chk_video_quality_manual_ratio"
          CHECK ("manual_settlement_ratio" IS NULL OR ("manual_settlement_ratio" >= 0 AND "manual_settlement_ratio" <= 1)),
        ADD CONSTRAINT "chk_video_quality_review_revision"
          CHECK ("review_revision" >= 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "video_quality_results"
        DROP CONSTRAINT IF EXISTS "chk_video_quality_review_revision",
        DROP CONSTRAINT IF EXISTS "chk_video_quality_manual_ratio",
        DROP CONSTRAINT IF EXISTS "chk_video_quality_manual_score",
        DROP CONSTRAINT IF EXISTS "fk_video_quality_manual_reviewer"
    `);
    await queryRunner.query(`
      ALTER TABLE "video_quality_results"
        DROP COLUMN IF EXISTS "review_revision",
        DROP COLUMN IF EXISTS "manual_reviewed_at",
        DROP COLUMN IF EXISTS "manual_reviewed_by_name",
        DROP COLUMN IF EXISTS "manual_reviewed_by_account_id",
        DROP COLUMN IF EXISTS "manual_review_reason",
        DROP COLUMN IF EXISTS "manual_issues",
        DROP COLUMN IF EXISTS "manual_billable_duration_ms",
        DROP COLUMN IF EXISTS "manual_invalid_duration_ms",
        DROP COLUMN IF EXISTS "manual_settlement_ratio",
        DROP COLUMN IF EXISTS "manual_final_score"
    `);
  }
}
