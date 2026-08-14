import type { MigrationInterface, QueryRunner } from "typeorm";

export class PublicSiteSnapshots2026081300015
  implements MigrationInterface
{
  name = "PublicSiteSnapshots2026081300015";
  timestamp = 2_026_081_300_015;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "public_site_snapshots" (
        "id" varchar(64) PRIMARY KEY,
        "revision" integer NOT NULL,
        "snapshot_date" date NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "deliverable_video_count" integer NOT NULL,
        "effective_duration_seconds" bigint NOT NULL,
        "scene_count" integer NOT NULL,
        "quality_pass_rate" numeric(6,2) NOT NULL,
        "primary_scene_name" varchar(80) NOT NULL,
        "primary_scene_description" varchar(200) NOT NULL,
        "cta_copy" varchar(160) NOT NULL,
        "scene_breakdown" jsonb NOT NULL,
        "trend" jsonb NOT NULL,
        "generated_by_account_id" varchar(64),
        "generated_by_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_public_site_snapshots_generator"
          FOREIGN KEY ("generated_by_account_id")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "chk_public_site_snapshots_revision"
          CHECK ("revision" > 0),
        CONSTRAINT "chk_public_site_snapshots_video_count"
          CHECK ("deliverable_video_count" >= 0),
        CONSTRAINT "chk_public_site_snapshots_duration"
          CHECK ("effective_duration_seconds" >= 0),
        CONSTRAINT "chk_public_site_snapshots_scene_count"
          CHECK ("scene_count" >= 0),
        CONSTRAINT "chk_public_site_snapshots_pass_rate"
          CHECK ("quality_pass_rate" >= 0 AND "quality_pass_rate" <= 100),
        CONSTRAINT "chk_public_site_snapshots_scenes_array"
          CHECK (jsonb_typeof("scene_breakdown") = 'array'),
        CONSTRAINT "chk_public_site_snapshots_trend_array"
          CHECK (jsonb_typeof("trend") = 'array')
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_public_site_snapshots_active" ON "public_site_snapshots" ("active") WHERE "active" = true',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_public_site_snapshots_date" ON "public_site_snapshots" ("snapshot_date")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_public_site_snapshots_created_at" ON "public_site_snapshots" ("created_at")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "public_site_snapshots"');
  }
}
