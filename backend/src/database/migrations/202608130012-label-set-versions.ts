import type { MigrationInterface, QueryRunner } from "typeorm";

export class LabelSetVersions2026081300012
  implements MigrationInterface
{
  name = "LabelSetVersions2026081300012";
  timestamp = 2_026_081_300_012;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "label_set_versions" (
        "id" varchar(64) PRIMARY KEY,
        "revision" integer NOT NULL,
        "version" varchar(64) NOT NULL,
        "labels" jsonb NOT NULL,
        "active" boolean NOT NULL DEFAULT false,
        "created_by_account_id" varchar(64) NOT NULL,
        "created_by_name" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_label_set_versions_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_label_set_versions_revision" CHECK ("revision" > 0),
        CONSTRAINT "chk_label_set_versions_labels_array"
          CHECK (jsonb_typeof("labels") = 'array')
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_label_set_versions_revision" ON "label_set_versions" ("revision")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_label_set_versions_active" ON "label_set_versions" ("active") WHERE "active" = true',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "label_set_versions"');
  }
}
