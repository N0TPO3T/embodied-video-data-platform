import type { MigrationInterface, QueryRunner } from "typeorm";

export class ScarcityConfigAndMediaScene2026081900001
  implements MigrationInterface
{
  name = "ScarcityConfigAndMediaScene2026081900001";
  timestamp = 2_026_081_900_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "scarcity_config" (
        "id" varchar(64) NOT NULL,
        "revision" integer NOT NULL,
        "version" varchar(64) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "tiers" jsonb NOT NULL,
        "weights" jsonb NOT NULL,
        "description" text NOT NULL,
        "created_by_account_id" varchar(64) NOT NULL,
        "created_by_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_scarcity_config" PRIMARY KEY ("id"),
        CONSTRAINT "uq_scarcity_config_revision" UNIQUE ("revision"),
        CONSTRAINT "fk_scarcity_config_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_scarcity_config_created_by" ON "scarcity_config" ("created_by_account_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "media_metadata"
        ADD COLUMN "scene_id" varchar(64),
        ADD COLUMN "task_id" varchar(64),
        ADD COLUMN "variant_id" varchar(64)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_media_metadata_scene_id" ON "media_metadata" ("scene_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_media_metadata_scene_id"',
    );
    await queryRunner.query(`
      ALTER TABLE "media_metadata"
        DROP COLUMN IF EXISTS "scene_id",
        DROP COLUMN IF EXISTS "task_id",
        DROP COLUMN IF EXISTS "variant_id"
    `);
    await queryRunner.query('DROP TABLE IF EXISTS "scarcity_config"');
  }
}
