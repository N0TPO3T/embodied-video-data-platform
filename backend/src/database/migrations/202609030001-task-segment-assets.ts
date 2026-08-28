import type { MigrationInterface, QueryRunner } from "typeorm";

export class TaskSegmentAssets2026090300001 implements MigrationInterface {
  name = "TaskSegmentAssets2026090300001";
  timestamp = 2_026_090_300_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "task_segment_assets" (
        "id" varchar(64) PRIMARY KEY,
        "submission_id" varchar(64) NOT NULL,
        "annotation_run_id" varchar(64) NOT NULL,
        "task_index" integer NOT NULL,
        "pipeline_version" varchar(80) NOT NULL,
        "prompt_version" varchar(120) NOT NULL,
        "schema_version" varchar(80) NOT NULL,
        "evidence_policy_version" varchar(80) NOT NULL,
        "ontology_version" varchar(80),
        "task_label" varchar(200) NOT NULL,
        "task_verb" varchar(80) NOT NULL,
        "completion" varchar(32) NOT NULL,
        "result_status" varchar(32) NOT NULL,
        "source_start_ms" double precision NOT NULL,
        "source_end_ms" double precision NOT NULL,
        "clip_start_ms" double precision NOT NULL,
        "clip_end_ms" double precision NOT NULL,
        "coverage_snapshot" jsonb NOT NULL,
        "evidence_snapshot" jsonb NOT NULL,
        "validation_warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "source_object_key" text NOT NULL,
        "source_sha256" char(64) NOT NULL,
        "clip_object_key" text,
        "clip_sha256" char(64),
        "clip_size_bytes" bigint,
        "clip_duration_ms" integer,
        "codec" varchar(64),
        "width" integer,
        "height" integer,
        "frame_rate" double precision,
        "has_audio" boolean,
        "generation_status" varchar(24) NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "failure_code" varchar(80),
        "failure_message" text,
        "usage_status" varchar(24) NOT NULL DEFAULT 'internal_only',
        "generation_policy_version" varchar(80) NOT NULL,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_task_segment_assets_submission"
          FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_task_segment_assets_annotation_run"
          FOREIGN KEY ("annotation_run_id") REFERENCES "annotation_runs"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_task_segment_assets_task_index" CHECK ("task_index" >= 0),
        CONSTRAINT "chk_task_segment_assets_generation_status"
          CHECK ("generation_status" IN ('queued', 'processing', 'ready', 'failed', 'skipped')),
        CONSTRAINT "chk_task_segment_assets_attempt_count" CHECK ("attempt_count" >= 0),
        CONSTRAINT "chk_task_segment_assets_usage_status" CHECK ("usage_status" = 'internal_only'),
        CONSTRAINT "chk_task_segment_assets_clip_ready"
          CHECK (
            "generation_status" <> 'ready' OR
            ("clip_object_key" IS NOT NULL AND "clip_sha256" IS NOT NULL
              AND "clip_size_bytes" > 0 AND "clip_duration_ms" > 0
              AND "codec" IS NOT NULL AND "width" > 0 AND "height" > 0
              AND "frame_rate" > 0 AND "has_audio" IS NOT NULL
              AND "completed_at" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_task_segment_assets_run_task"
      ON "task_segment_assets" ("annotation_run_id", "task_index")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_task_segment_assets_submission_created"
      ON "task_segment_assets" ("submission_id", "created_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_task_segment_assets_status_created"
      ON "task_segment_assets" ("generation_status", "created_at" DESC, "id" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "task_segment_assets"');
  }
}
