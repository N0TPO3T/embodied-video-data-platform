import type { MigrationInterface, QueryRunner } from "typeorm";

export class QualityRuleVersions2026081300011
  implements MigrationInterface
{
  name = "QualityRuleVersions2026081300011";
  timestamp = 2_026_081_300_011;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "quality_rule_versions" (
        "id" varchar(64) PRIMARY KEY,
        "revision" integer NOT NULL,
        "version" varchar(64) NOT NULL,
        "pass_threshold" integer NOT NULL,
        "description" text NOT NULL,
        "active" boolean NOT NULL DEFAULT false,
        "created_by_account_id" varchar(64) NOT NULL,
        "created_by_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_quality_rule_versions_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_quality_rule_versions_revision" CHECK ("revision" > 0),
        CONSTRAINT "chk_quality_rule_versions_pass_threshold"
          CHECK ("pass_threshold" >= 0 AND "pass_threshold" <= 100)
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_quality_rule_versions_revision" ON "quality_rule_versions" ("revision")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_quality_rule_versions_active" ON "quality_rule_versions" ("active") WHERE "active" = true',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_quality_rule_versions_version" ON "quality_rule_versions" ("version")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "quality_rule_versions"');
  }
}
