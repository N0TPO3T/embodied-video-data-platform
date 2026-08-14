import type { MigrationInterface, QueryRunner } from "typeorm";

export class RuleSnapshots2026081300014 implements MigrationInterface {
  name = "RuleSnapshots2026081300014";
  timestamp = 2_026_081_300_014;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "video_quality_results"
      ADD COLUMN "quality_rule_version_id" varchar(64),
      ADD COLUMN "quality_rule_revision" integer,
      ADD COLUMN "label_set_version_id" varchar(64),
      ADD COLUMN "label_set_revision" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "video_quality_results"
      ADD CONSTRAINT "fk_video_quality_results_quality_rule"
        FOREIGN KEY ("quality_rule_version_id")
        REFERENCES "quality_rule_versions"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "fk_video_quality_results_label_set"
        FOREIGN KEY ("label_set_version_id")
        REFERENCES "label_set_versions"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "point_cycles"
      ADD COLUMN "point_rule_version_id" varchar(64),
      ADD COLUMN "point_rule_revision" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "point_cycles"
      ADD CONSTRAINT "fk_point_cycles_point_rule"
        FOREIGN KEY ("point_rule_version_id")
        REFERENCES "point_rule_versions"("id") ON DELETE RESTRICT
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "point_cycles"
      DROP CONSTRAINT IF EXISTS "fk_point_cycles_point_rule",
      DROP COLUMN IF EXISTS "point_rule_revision",
      DROP COLUMN IF EXISTS "point_rule_version_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "video_quality_results"
      DROP CONSTRAINT IF EXISTS "fk_video_quality_results_label_set",
      DROP CONSTRAINT IF EXISTS "fk_video_quality_results_quality_rule",
      DROP COLUMN IF EXISTS "label_set_revision",
      DROP COLUMN IF EXISTS "label_set_version_id",
      DROP COLUMN IF EXISTS "quality_rule_revision",
      DROP COLUMN IF EXISTS "quality_rule_version_id"
    `);
  }
}
