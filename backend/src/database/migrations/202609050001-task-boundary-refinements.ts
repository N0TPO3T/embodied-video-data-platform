import type { MigrationInterface, QueryRunner } from "typeorm";

export class TaskBoundaryRefinements2026090500001 implements MigrationInterface {
  name = "TaskBoundaryRefinements2026090500001";
  timestamp = 2_026_090_500_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "task_boundary_refinements" (
        "id" varchar(64) PRIMARY KEY,
        "submission_id" varchar(64) NOT NULL,
        "annotation_run_id" varchar(64) NOT NULL,
        "task_index" integer NOT NULL,
        "policy_version" varchar(80) NOT NULL,
        "prompt_version" varchar(80) NOT NULL,
        "model_version" varchar(120) NOT NULL,
        "coarse_start_ms" double precision NOT NULL,
        "coarse_end_ms" double precision NOT NULL,
        "refined_start_ms" double precision,
        "refined_end_ms" double precision,
        "start_status" varchar(24) NOT NULL,
        "end_status" varchar(24) NOT NULL,
        "start_reason_code" varchar(80),
        "end_reason_code" varchar(80),
        "sample_manifest" jsonb,
        "raw_model_output" jsonb,
        "validation_issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "input_tokens" integer,
        "output_tokens" integer,
        "model_latency_ms" integer,
        "execution_status" varchar(24) NOT NULL,
        "failure_code" varchar(80),
        "failure_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz,
        CONSTRAINT "fk_task_boundary_refinements_submission"
          FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_task_boundary_refinements_annotation_run"
          FOREIGN KEY ("annotation_run_id") REFERENCES "annotation_runs"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_task_boundary_refinements_task_index" CHECK ("task_index" >= 0),
        CONSTRAINT "chk_task_boundary_refinements_coarse_range" CHECK ("coarse_start_ms" >= 0 AND "coarse_end_ms" > "coarse_start_ms"),
        CONSTRAINT "chk_task_boundary_refinements_side_status"
          CHECK ("start_status" IN ('refined', 'unchanged', 'not_observable', 'failed')
            AND "end_status" IN ('refined', 'unchanged', 'not_observable', 'failed')),
        CONSTRAINT "chk_task_boundary_refinements_execution_status"
          CHECK ("execution_status" IN ('queued', 'running', 'succeeded', 'fallback', 'system_failed')),
        CONSTRAINT "chk_task_boundary_refinements_tokens"
          CHECK (("input_tokens" IS NULL OR "input_tokens" >= 0)
            AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
            AND ("model_latency_ms" IS NULL OR "model_latency_ms" >= 0))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_task_boundary_refinements_run_task_policy"
      ON "task_boundary_refinements" ("annotation_run_id", "task_index", "policy_version")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_task_boundary_refinements_submission_status"
      ON "task_boundary_refinements" ("submission_id", "execution_status", "created_at" DESC)
    `);
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        ADD COLUMN "boundary_refinement_id" varchar(64),
        ADD COLUMN "refined_start_ms" double precision,
        ADD COLUMN "refined_end_ms" double precision,
        ADD COLUMN "boundary_source" varchar(24) NOT NULL DEFAULT 'coarse',
        ADD COLUMN "boundary_refinement_policy_version" varchar(80),
        ADD CONSTRAINT "fk_task_segment_assets_boundary_refinement"
          FOREIGN KEY ("boundary_refinement_id") REFERENCES "task_boundary_refinements"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "chk_task_segment_assets_boundary_source"
          CHECK ("boundary_source" IN ('coarse', 'refined', 'coarse_fallback'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        DROP CONSTRAINT IF EXISTS "chk_task_segment_assets_boundary_source",
        DROP CONSTRAINT IF EXISTS "fk_task_segment_assets_boundary_refinement",
        DROP COLUMN IF EXISTS "boundary_refinement_policy_version",
        DROP COLUMN IF EXISTS "boundary_source",
        DROP COLUMN IF EXISTS "refined_end_ms",
        DROP COLUMN IF EXISTS "refined_start_ms",
        DROP COLUMN IF EXISTS "boundary_refinement_id"
    `);
    await queryRunner.query('DROP TABLE IF EXISTS "task_boundary_refinements"');
  }
}
