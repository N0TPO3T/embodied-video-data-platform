import type { MigrationInterface, QueryRunner } from "typeorm";

export class AiQualityProgressStuck2026081700001 implements MigrationInterface {
  name = "AiQualityProgressStuck2026081700001";
  timestamp = 2_026_081_700_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "submissions" DROP CONSTRAINT "chk_submissions_processing_status"',
    );
    await queryRunner.query(`
      ALTER TABLE "submissions" ADD CONSTRAINT "chk_submissions_processing_status"
        CHECK ("processing_status" IN (
          'uploading', 'queued', 'probing', 'awaiting_ai',
          'ai_processing', 'completed', 'stuck', 'system_failed'
        ))
    `);

    await queryRunner.query(
      'ALTER TABLE "video_quality_results" DROP CONSTRAINT "chk_video_quality_result_status"',
    );
    await queryRunner.query(`
      ALTER TABLE "video_quality_results" ADD CONSTRAINT "chk_video_quality_result_status"
        CHECK ("status" IN (
          'queued', 'running', 'scored', 'hard_reject',
          'review_pending', 'stuck', 'system_failed'
        ))
    `);

    await queryRunner.query(
      'ALTER TABLE "video_quality_results" ADD COLUMN "progress_stage" varchar(32)',
    );
    await queryRunner.query(
      'ALTER TABLE "video_quality_results" ADD COLUMN "progress_updated_at" timestamptz',
    );
    await queryRunner.query(
      'ALTER TABLE "video_quality_results" ADD COLUMN "stuck_reason" text',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_video_quality_results_progress_updated" ON "video_quality_results" ("progress_updated_at")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_video_quality_results_progress_updated"',
    );
    await queryRunner.query(
      'ALTER TABLE "video_quality_results" DROP COLUMN IF EXISTS "stuck_reason"',
    );
    await queryRunner.query(
      'ALTER TABLE "video_quality_results" DROP COLUMN IF EXISTS "progress_updated_at"',
    );
    await queryRunner.query(
      'ALTER TABLE "video_quality_results" DROP COLUMN IF EXISTS "progress_stage"',
    );
    await queryRunner.query(
      'ALTER TABLE "video_quality_results" DROP CONSTRAINT "chk_video_quality_result_status"',
    );
    await queryRunner.query(`
      ALTER TABLE "video_quality_results" ADD CONSTRAINT "chk_video_quality_result_status"
        CHECK ("status" IN (
          'queued', 'running', 'scored', 'hard_reject', 'review_pending', 'system_failed'
        ))
    `);
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
  }
}
