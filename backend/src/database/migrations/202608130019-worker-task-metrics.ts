import type { MigrationInterface, QueryRunner } from "typeorm";

export class WorkerTaskMetrics2026081300019 implements MigrationInterface {
  name = "WorkerTaskMetrics2026081300019";
  timestamp = 2_026_081_300_019;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "worker_heartbeats"
      ADD COLUMN "completed_task_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN "failed_task_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN "total_task_duration_ms" bigint NOT NULL DEFAULT 0,
      ADD COLUMN "last_task_duration_ms" integer,
      ADD COLUMN "max_task_duration_ms" integer NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "worker_heartbeats"
      DROP COLUMN IF EXISTS "max_task_duration_ms",
      DROP COLUMN IF EXISTS "last_task_duration_ms",
      DROP COLUMN IF EXISTS "total_task_duration_ms",
      DROP COLUMN IF EXISTS "failed_task_count",
      DROP COLUMN IF EXISTS "completed_task_count"
    `);
  }
}
