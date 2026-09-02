import type { MigrationInterface, QueryRunner } from "typeorm";

export class TaskSegmentAdaptiveCut2026090600001 implements MigrationInterface {
  name = "TaskSegmentAdaptiveCut2026090600001";
  timestamp = 2_026_090_600_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        ADD COLUMN "requested_start_ms" double precision,
        ADD COLUMN "requested_end_ms" double precision,
        ADD COLUMN "actual_start_ms" double precision,
        ADD COLUMN "actual_end_ms" double precision,
        ADD COLUMN "materialization_policy_version" varchar(80) NOT NULL DEFAULT 'legacy_stream_copy_unvalidated_v0',
        ADD COLUMN "materialization_mode" varchar(32) NOT NULL DEFAULT 'stream_copy',
        ADD COLUMN "source_codec" varchar(64),
        ADD COLUMN "source_nominal_fps" double precision,
        ADD COLUMN "source_has_audio" boolean,
        ADD COLUMN "source_duration_ms" integer,
        ADD COLUMN "requested_duration_ms" integer,
        ADD COLUMN "predicted_copy_start_ms" double precision,
        ADD COLUMN "keyframe_distance_start_ms" double precision,
        ADD COLUMN "boundary_tolerance_ms" double precision,
        ADD COLUMN "start_drift_ms" double precision,
        ADD COLUMN "end_drift_ms" double precision,
        ADD COLUMN "validation_status" varchar(24) NOT NULL DEFAULT 'pending',
        ADD COLUMN "validation_failure_code" varchar(80),
        ADD COLUMN "validation_failure_message" text,
        ADD COLUMN "stream_copy_attempted" boolean NOT NULL DEFAULT false,
        ADD COLUMN "copy_rejected_reason" varchar(120),
        ADD COLUMN "transcoded_input_duration_ms" integer,
        ADD COLUMN "materialization_started_at" timestamptz,
        ADD COLUMN "materialization_completed_at" timestamptz,
        ADD COLUMN "materialization_duration_ms" integer
    `);
    await queryRunner.query(`
      UPDATE "task_segment_assets"
      SET "requested_start_ms" = "clip_start_ms",
          "requested_end_ms" = "clip_end_ms"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        ALTER COLUMN "requested_start_ms" SET NOT NULL,
        ALTER COLUMN "requested_end_ms" SET NOT NULL,
        ADD CONSTRAINT "chk_task_segment_assets_requested_range"
          CHECK ("generation_status" = 'skipped'
            OR ("requested_start_ms" >= 0 AND "requested_end_ms" > "requested_start_ms")),
        ADD CONSTRAINT "chk_task_segment_assets_materialization_mode"
          CHECK ("materialization_mode" IN ('stream_copy', 'exact_clip_transcode')),
        ADD CONSTRAINT "chk_task_segment_assets_validation_status"
          CHECK ("validation_status" IN ('pending', 'passed', 'failed')),
        ADD CONSTRAINT "chk_task_segment_assets_materialization_metrics"
          CHECK (("source_nominal_fps" IS NULL OR "source_nominal_fps" > 0)
            AND ("source_duration_ms" IS NULL OR "source_duration_ms" > 0)
            AND ("requested_duration_ms" IS NULL OR "requested_duration_ms" > 0)
            AND ("boundary_tolerance_ms" IS NULL OR "boundary_tolerance_ms" >= 20)
            AND ("transcoded_input_duration_ms" IS NULL OR "transcoded_input_duration_ms" > 0)
            AND ("materialization_duration_ms" IS NULL OR "materialization_duration_ms" >= 0))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        DROP CONSTRAINT IF EXISTS "chk_task_segment_assets_materialization_metrics",
        DROP CONSTRAINT IF EXISTS "chk_task_segment_assets_validation_status",
        DROP CONSTRAINT IF EXISTS "chk_task_segment_assets_materialization_mode",
        DROP CONSTRAINT IF EXISTS "chk_task_segment_assets_requested_range",
        DROP COLUMN IF EXISTS "materialization_duration_ms",
        DROP COLUMN IF EXISTS "materialization_completed_at",
        DROP COLUMN IF EXISTS "materialization_started_at",
        DROP COLUMN IF EXISTS "transcoded_input_duration_ms",
        DROP COLUMN IF EXISTS "copy_rejected_reason",
        DROP COLUMN IF EXISTS "stream_copy_attempted",
        DROP COLUMN IF EXISTS "validation_failure_message",
        DROP COLUMN IF EXISTS "validation_failure_code",
        DROP COLUMN IF EXISTS "validation_status",
        DROP COLUMN IF EXISTS "end_drift_ms",
        DROP COLUMN IF EXISTS "start_drift_ms",
        DROP COLUMN IF EXISTS "boundary_tolerance_ms",
        DROP COLUMN IF EXISTS "keyframe_distance_start_ms",
        DROP COLUMN IF EXISTS "predicted_copy_start_ms",
        DROP COLUMN IF EXISTS "requested_duration_ms",
        DROP COLUMN IF EXISTS "source_duration_ms",
        DROP COLUMN IF EXISTS "source_has_audio",
        DROP COLUMN IF EXISTS "source_nominal_fps",
        DROP COLUMN IF EXISTS "source_codec",
        DROP COLUMN IF EXISTS "materialization_mode",
        DROP COLUMN IF EXISTS "materialization_policy_version",
        DROP COLUMN IF EXISTS "actual_end_ms",
        DROP COLUMN IF EXISTS "actual_start_ms",
        DROP COLUMN IF EXISTS "requested_end_ms",
        DROP COLUMN IF EXISTS "requested_start_ms"
    `);
  }
}
