import type { MigrationInterface, QueryRunner } from "typeorm";

export class Identity2026080700001 implements MigrationInterface {
  name = "Identity2026080700001";
  timestamp = 2_026_080_700_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "citext"');
    await queryRunner.query(`
      CREATE TABLE "teams" (
        "id" varchar(64) PRIMARY KEY,
        "name" varchar(120) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "unit_price_per_minute" numeric(12,4) NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_teams_status" CHECK ("status" IN ('active', 'disabled'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" varchar(64) PRIMARY KEY,
        "display_name" varchar(120) NOT NULL,
        "username" varchar(80) NOT NULL,
        "username_normalized" citext NOT NULL,
        "password_hash" text NOT NULL,
        "role" varchar(16) NOT NULL,
        "team_id" varchar(64),
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "failed_attempt_count" integer NOT NULL DEFAULT 0,
        "first_failed_at" timestamptz,
        "locked_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_users_team" FOREIGN KEY ("team_id")
          REFERENCES "teams"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_users_role"
          CHECK ("role" IN ('admin', 'leader', 'collector')),
        CONSTRAINT "chk_users_status"
          CHECK ("status" IN ('active', 'disabled')),
        CONSTRAINT "chk_users_team_role"
          CHECK (
            ("role" = 'admin' AND "team_id" IS NULL)
            OR ("role" IN ('leader', 'collector') AND "team_id" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "idx_users_username_normalized" ON "users" ("username_normalized")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_users_role_status" ON "users" ("role", "status")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_users_team_id" ON "users" ("team_id")',
    );
    await queryRunner.query(`
      CREATE TABLE "sessions" (
        "token_hash" char(64) PRIMARY KEY,
        "account_id" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        CONSTRAINT "fk_sessions_account" FOREIGN KEY ("account_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_sessions_account_id" ON "sessions" ("account_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_sessions_expires_at" ON "sessions" ("expires_at")',
    );
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" varchar(64) PRIMARY KEY,
        "actor_account_id" varchar(64) NOT NULL,
        "actor_name" varchar(120) NOT NULL,
        "action" varchar(64) NOT NULL,
        "target_account_id" varchar(64) NOT NULL,
        "target_name" varchar(120) NOT NULL,
        "summary" text NOT NULL,
        "before_value" jsonb,
        "after_value" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs" ("created_at" DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_audit_logs_target" ON "audit_logs" ("target_account_id")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "audit_logs"');
    await queryRunner.query('DROP TABLE IF EXISTS "sessions"');
    await queryRunner.query('DROP TABLE IF EXISTS "users"');
    await queryRunner.query('DROP TABLE IF EXISTS "teams"');
  }
}
