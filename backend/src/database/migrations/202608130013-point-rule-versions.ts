import type { MigrationInterface, QueryRunner } from "typeorm";

export class PointRuleVersions2026081300013
  implements MigrationInterface
{
  name = "PointRuleVersions2026081300013";
  timestamp = 2_026_081_300_013;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "point_rule_versions" (
        "id" varchar(64) PRIMARY KEY,
        "revision" integer NOT NULL,
        "version" varchar(64) NOT NULL,
        "default_points_per_minute" numeric(12,4) NOT NULL,
        "coefficient_bands" jsonb NOT NULL,
        "description" text NOT NULL,
        "active" boolean NOT NULL DEFAULT false,
        "created_by_account_id" varchar(64) NOT NULL,
        "created_by_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_point_rule_versions_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_point_rule_versions_revision" CHECK ("revision" > 0),
        CONSTRAINT "chk_point_rule_versions_default_points"
          CHECK ("default_points_per_minute" >= 0),
        CONSTRAINT "chk_point_rule_versions_bands_array"
          CHECK (jsonb_typeof("coefficient_bands") = 'array')
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_point_rule_versions_revision" ON "point_rule_versions" ("revision")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_point_rule_versions_active" ON "point_rule_versions" ("active") WHERE "active" = true',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_point_rule_versions_version" ON "point_rule_versions" ("version")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "point_rule_versions"');
  }
}
