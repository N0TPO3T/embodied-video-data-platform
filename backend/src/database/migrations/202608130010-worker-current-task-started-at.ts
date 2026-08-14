import type { MigrationInterface, QueryRunner } from "typeorm";

export class WorkerCurrentTaskStartedAt2026081300010
  implements MigrationInterface
{
  name = "WorkerCurrentTaskStartedAt2026081300010";
  timestamp = 2_026_081_300_010;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "worker_heartbeats"
      ADD COLUMN "current_task_started_at" timestamptz
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "worker_heartbeats"
      DROP COLUMN IF EXISTS "current_task_started_at"
    `);
  }
}
