import type { MigrationInterface, QueryRunner } from "typeorm";

export class HlsPreviewAssets2026081300021 implements MigrationInterface {
  name = "HlsPreviewAssets2026081300021";
  timestamp = 2_026_081_300_021;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "media_metadata"
      ADD COLUMN "hls_master_object_key" text,
      ADD COLUMN "hls_base_object_key" text,
      ADD COLUMN "hls_qualities" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN "hls_object_keys" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "media_metadata"
      DROP COLUMN IF EXISTS "hls_object_keys",
      DROP COLUMN IF EXISTS "hls_qualities",
      DROP COLUMN IF EXISTS "hls_base_object_key",
      DROP COLUMN IF EXISTS "hls_master_object_key"
    `);
  }
}
