import type { MigrationInterface, QueryRunner } from "typeorm";

export class UploadAuthorization2026081300016
  implements MigrationInterface
{
  name = "UploadAuthorization2026081300016";
  timestamp = 2_026_081_300_016;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "submissions"
      ADD COLUMN "data_usage_authorized" boolean NOT NULL DEFAULT false,
      ADD COLUMN "privacy_confirmed" boolean NOT NULL DEFAULT false,
      ADD COLUMN "sensitive_content_confirmed" boolean NOT NULL DEFAULT false,
      ADD COLUMN "upload_policy_version" varchar(64) NOT NULL DEFAULT 'DATA-AUTH-2026-08',
      ADD COLUMN "authorization_confirmed_at" timestamptz
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "submissions"
      DROP COLUMN IF EXISTS "authorization_confirmed_at",
      DROP COLUMN IF EXISTS "upload_policy_version",
      DROP COLUMN IF EXISTS "sensitive_content_confirmed",
      DROP COLUMN IF EXISTS "privacy_confirmed",
      DROP COLUMN IF EXISTS "data_usage_authorized"
    `);
  }
}
