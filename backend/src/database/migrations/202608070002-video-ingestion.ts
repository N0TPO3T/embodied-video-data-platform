import type { MigrationInterface, QueryRunner } from "typeorm";

export class VideoIngestion2026080700002 implements MigrationInterface {
  name = "VideoIngestion2026080700002";
  timestamp = 2_026_080_700_002;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "submissions" (
        "id" varchar(64) PRIMARY KEY,
        "owner_id" varchar(64) NOT NULL,
        "team_id" varchar(64) NOT NULL,
        "original_file_name" varchar(255) NOT NULL,
        "content_type" varchar(64) NOT NULL,
        "expected_size_bytes" bigint NOT NULL,
        "checksum_sha256" char(64) NOT NULL,
        "object_key" text NOT NULL,
        "multipart_upload_id" text,
        "upload_status" varchar(16) NOT NULL,
        "processing_status" varchar(24) NOT NULL,
        "failure_code" varchar(64),
        "failure_message" text,
        "is_test_data" boolean NOT NULL DEFAULT false,
        "uploaded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_submissions_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_submissions_team" FOREIGN KEY ("team_id")
          REFERENCES "teams"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_submissions_content_type"
          CHECK ("content_type" IN ('video/mp4', 'video/quicktime')),
        CONSTRAINT "chk_submissions_expected_size"
          CHECK ("expected_size_bytes" > 0 AND "expected_size_bytes" <= 2147483648),
        CONSTRAINT "chk_submissions_checksum"
          CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_submissions_upload_status"
          CHECK ("upload_status" IN ('created', 'uploading', 'uploaded', 'aborted')),
        CONSTRAINT "chk_submissions_processing_status"
          CHECK ("processing_status" IN (
            'uploading', 'queued', 'probing', 'awaiting_ai',
            'completed', 'system_failed'
          ))
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "idx_submissions_object_key" ON "submissions" ("object_key")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "idx_submissions_active_multipart" ON "submissions" ("multipart_upload_id") WHERE "multipart_upload_id" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_submissions_owner_created" ON "submissions" ("owner_id", "created_at" DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_submissions_team_created" ON "submissions" ("team_id", "created_at" DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_submissions_processing_status" ON "submissions" ("processing_status")',
    );

    await queryRunner.query(`
      CREATE TABLE "media_metadata" (
        "submission_id" varchar(64) PRIMARY KEY,
        "duration_seconds" numeric(14,3) NOT NULL,
        "width" integer NOT NULL,
        "height" integer NOT NULL,
        "frame_rate" numeric(10,3) NOT NULL,
        "codec" varchar(64) NOT NULL,
        "bitrate" bigint,
        "size_bytes" bigint NOT NULL,
        "raw_probe" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_media_metadata_submission" FOREIGN KEY ("submission_id")
          REFERENCES "submissions"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_media_metadata_duration" CHECK ("duration_seconds" > 0),
        CONSTRAINT "chk_media_metadata_dimensions" CHECK ("width" > 0 AND "height" > 0),
        CONSTRAINT "chk_media_metadata_frame_rate" CHECK ("frame_rate" > 0),
        CONSTRAINT "chk_media_metadata_size" CHECK ("size_bytes" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "media_segments" (
        "id" varchar(64) PRIMARY KEY,
        "submission_id" varchar(64) NOT NULL,
        "type" varchar(16) NOT NULL,
        "start_seconds" numeric(14,3) NOT NULL,
        "end_seconds" numeric(14,3) NOT NULL,
        "invalid" boolean NOT NULL DEFAULT true,
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_media_segments_submission" FOREIGN KEY ("submission_id")
          REFERENCES "submissions"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_media_segments_type" CHECK ("type" IN ('black', 'freeze')),
        CONSTRAINT "chk_media_segments_range"
          CHECK ("start_seconds" >= 0 AND "end_seconds" > "start_seconds")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_media_segments_submission_start" ON "media_segments" ("submission_id", "start_seconds")',
    );

    await queryRunner.query(`
      CREATE TABLE "job_outbox" (
        "id" varchar(64) PRIMARY KEY,
        "aggregate_type" varchar(32) NOT NULL,
        "aggregate_id" varchar(64) NOT NULL,
        "event_type" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz,
        "last_error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_job_outbox_status"
          CHECK ("status" IN ('pending', 'published')),
        CONSTRAINT "chk_job_outbox_attempts" CHECK ("attempts" >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_job_outbox_event_aggregate" ON "job_outbox" ("event_type", "aggregate_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_job_outbox_ready" ON "job_outbox" ("status", "available_at", "created_at")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "job_outbox"');
    await queryRunner.query('DROP TABLE IF EXISTS "media_segments"');
    await queryRunner.query('DROP TABLE IF EXISTS "media_metadata"');
    await queryRunner.query('DROP TABLE IF EXISTS "submissions"');
  }
}
