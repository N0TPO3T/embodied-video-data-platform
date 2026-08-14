import type { MigrationInterface, QueryRunner } from "typeorm";

export class WorkerHeartbeats2026081300009
  implements MigrationInterface
{
  name = "WorkerHeartbeats2026081300009";
  timestamp = 2_026_081_300_009;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "worker_heartbeats" (
        "id" varchar(120) PRIMARY KEY,
        "kind" varchar(32) NOT NULL,
        "host_name" varchar(160) NOT NULL,
        "process_id" integer NOT NULL,
        "status" varchar(16) NOT NULL,
        "current_submission_id" varchar(64),
        "last_error" text,
        "started_at" timestamptz NOT NULL,
        "last_seen_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_worker_heartbeats_kind"
          CHECK ("kind" IN ('media', 'ai_quality')),
        CONSTRAINT "chk_worker_heartbeats_status"
          CHECK ("status" IN ('idle', 'running', 'stopped'))
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_worker_heartbeats_kind_seen" ON "worker_heartbeats" ("kind", "last_seen_at" DESC)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "worker_heartbeats"');
  }
}
