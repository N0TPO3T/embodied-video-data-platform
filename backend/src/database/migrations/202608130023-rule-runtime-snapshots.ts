import type { MigrationInterface, QueryRunner } from "typeorm";

export class RuleRuntimeSnapshots2026081300023 implements MigrationInterface {
  name = "RuleRuntimeSnapshots2026081300023";
  timestamp = 2_026_081_300_023;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "video_quality_results"
      ADD COLUMN "quality_rule_snapshot" jsonb,
      ADD COLUMN "label_set_snapshot" jsonb,
      ADD COLUMN "passed" boolean
    `);
    await queryRunner.query(`
      UPDATE "video_quality_results" AS quality
      SET "quality_rule_snapshot" = jsonb_build_object(
        'id', rule."id",
        'revision', rule."revision",
        'version', rule."version",
        'passThreshold', rule."pass_threshold",
        'description', rule."description"
      )
      FROM "quality_rule_versions" AS rule
      WHERE rule."id" = quality."quality_rule_version_id"
    `);
    await queryRunner.query(`
      UPDATE "video_quality_results" AS quality
      SET "label_set_snapshot" = jsonb_build_object(
        'id', label_set."id",
        'revision', label_set."revision",
        'version', label_set."version",
        'labels', label_set."labels"
      )
      FROM "label_set_versions" AS label_set
      WHERE label_set."id" = quality."label_set_version_id"
    `);
    await queryRunner.query(`
      UPDATE "video_quality_results" AS quality
      SET "passed" = CASE
        WHEN quality."manual_final_score" IS NOT NULL THEN
          quality."manual_final_score" >= COALESCE(
            (quality."quality_rule_snapshot" ->> 'passThreshold')::numeric,
            60
          )
        WHEN quality."status" = 'scored' AND quality."final_score" IS NOT NULL THEN
          quality."final_score" >= COALESCE(
            (quality."quality_rule_snapshot" ->> 'passThreshold')::numeric,
            60
          )
        WHEN quality."status" = 'hard_reject' THEN false
        ELSE NULL
      END
    `);
    await queryRunner.query(`
      ALTER TABLE "point_cycles"
      ADD COLUMN "point_rule_snapshot" jsonb
    `);
    await queryRunner.query(`
      UPDATE "point_cycles" AS cycle
      SET "point_rule_snapshot" = jsonb_build_object(
        'id', rule."id",
        'revision', rule."revision",
        'version', rule."version",
        'defaultPointsPerMinute', rule."default_points_per_minute"::numeric,
        'coefficientBands', rule."coefficient_bands",
        'description', rule."description"
      )
      FROM "point_rule_versions" AS rule
      WHERE rule."id" = cycle."point_rule_version_id"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "point_cycles"
      DROP COLUMN IF EXISTS "point_rule_snapshot"
    `);
    await queryRunner.query(`
      ALTER TABLE "video_quality_results"
      DROP COLUMN IF EXISTS "passed",
      DROP COLUMN IF EXISTS "label_set_snapshot",
      DROP COLUMN IF EXISTS "quality_rule_snapshot"
    `);
  }
}
