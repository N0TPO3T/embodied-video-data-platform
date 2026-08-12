import type { MigrationInterface, QueryRunner } from "typeorm";

export class AiQuality2026081200003 implements MigrationInterface {
  name = "AiQuality2026081200003";
  timestamp = 2_026_081_200_003;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "submissions" DROP CONSTRAINT "chk_submissions_processing_status"',
    );
    await queryRunner.query(`
      ALTER TABLE "submissions" ADD CONSTRAINT "chk_submissions_processing_status"
        CHECK ("processing_status" IN (
          'uploading', 'queued', 'probing', 'awaiting_ai',
          'ai_processing', 'completed', 'system_failed'
        ))
    `);

    await queryRunner.query(`
      CREATE TABLE "video_quality_prompt_versions" (
        "id" varchar(64) PRIMARY KEY,
        "revision" integer NOT NULL,
        "system_prompt" text NOT NULL,
        "content_sha256" char(64) NOT NULL,
        "prompt_version" varchar(64) NOT NULL,
        "rule_version" varchar(64) NOT NULL,
        "output_schema" varchar(64) NOT NULL,
        "initial_model" varchar(120) NOT NULL,
        "review_model" varchar(120) NOT NULL,
        "active" boolean NOT NULL DEFAULT false,
        "created_by_account_id" varchar(64) NOT NULL,
        "created_by_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_video_quality_prompt_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_video_quality_prompt_revision" CHECK ("revision" > 0),
        CONSTRAINT "chk_video_quality_prompt_sha256" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$')
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_video_quality_prompt_revision" ON "video_quality_prompt_versions" ("revision")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_video_quality_prompt_active" ON "video_quality_prompt_versions" ("active") WHERE "active" = true',
    );

    await queryRunner.query(`
      CREATE TABLE "video_quality_results" (
        "submission_id" varchar(64) PRIMARY KEY,
        "status" varchar(24) NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "prompt_version_id" varchar(64) NOT NULL,
        "prompt_revision" integer NOT NULL,
        "prompt_content_sha256" char(64) NOT NULL,
        "system_prompt_snapshot" text NOT NULL,
        "initial_model" varchar(120) NOT NULL,
        "review_model" varchar(120) NOT NULL,
        "model_runs" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "final_score" numeric(6,1),
        "raw_total_score" numeric(6,1),
        "settlement_ratio" numeric(6,4),
        "invalid_duration_ms" bigint,
        "billable_duration_ms" bigint,
        "summary" text NOT NULL DEFAULT '',
        "recommendations" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "deductions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "review_required" boolean NOT NULL DEFAULT false,
        "review_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "normalized_result" jsonb,
        "raw_model_result" jsonb,
        "last_error" text,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_video_quality_result_submission" FOREIGN KEY ("submission_id")
          REFERENCES "submissions"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_video_quality_result_prompt" FOREIGN KEY ("prompt_version_id")
          REFERENCES "video_quality_prompt_versions"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_video_quality_result_status" CHECK ("status" IN (
          'queued', 'running', 'scored', 'hard_reject', 'review_pending', 'system_failed'
        )),
        CONSTRAINT "chk_video_quality_result_attempts" CHECK ("attempts" >= 0),
        CONSTRAINT "chk_video_quality_result_prompt_sha256" CHECK ("prompt_content_sha256" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_video_quality_result_score" CHECK ("final_score" IS NULL OR ("final_score" >= 0 AND "final_score" <= 100)),
        CONSTRAINT "chk_video_quality_result_ratio" CHECK ("settlement_ratio" IS NULL OR ("settlement_ratio" >= 0 AND "settlement_ratio" <= 1))
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_video_quality_results_status_updated" ON "video_quality_results" ("status", "updated_at")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "video_quality_results"');
    await queryRunner.query('DROP TABLE IF EXISTS "video_quality_prompt_versions"');
    await queryRunner.query(
      'ALTER TABLE "submissions" DROP CONSTRAINT "chk_submissions_processing_status"',
    );
    await queryRunner.query(`
      ALTER TABLE "submissions" ADD CONSTRAINT "chk_submissions_processing_status"
        CHECK ("processing_status" IN (
          'uploading', 'queued', 'probing', 'awaiting_ai',
          'completed', 'system_failed'
        ))
    `);
  }
}
