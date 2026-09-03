import type { MigrationInterface, QueryRunner } from "typeorm";

export class TaskSegmentAnnotationPublication2026091200001 implements MigrationInterface {
  name = "TaskSegmentAnnotationPublication2026091200001";
  timestamp = 2_026_091_200_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "task_segment_annotation_revisions" (
        "id" varchar(64) NOT NULL PRIMARY KEY,
        "task_segment_asset_id" varchar(64) NOT NULL,
        "revision" integer NOT NULL,
        "schema_version" varchar(80) NOT NULL,
        "taxonomy_version" varchar(120),
        "source_annotation_run_id" varchar(64) NOT NULL,
        "source_annotation_review_revision" integer NOT NULL,
        "source_annotation_publication_status" varchar(24) NOT NULL,
        "boundary_refinement_policy_version" varchar(80),
        "materialization_policy_version" varchar(80) NOT NULL,
        "video_sha256" char(64) NOT NULL,
        "source_fingerprint" char(64) NOT NULL,
        "json_object_key" text NOT NULL,
        "json_sha256" char(64) NOT NULL,
        "json_size_bytes" bigint NOT NULL,
        "content_json" jsonb NOT NULL,
        "canonical_json" text NOT NULL,
        "publication_status" varchar(24) NOT NULL,
        "attempt_count" integer NOT NULL,
        "failure_code" varchar(80),
        "failure_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "published_at" timestamptz,
        CONSTRAINT "fk_segment_annotation_asset" FOREIGN KEY ("task_segment_asset_id")
          REFERENCES "task_segment_assets" ("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_segment_annotation_revision" UNIQUE ("task_segment_asset_id", "revision"),
        CONSTRAINT "uq_segment_annotation_fingerprint" UNIQUE ("task_segment_asset_id", "source_fingerprint"),
        CONSTRAINT "uq_segment_annotation_object" UNIQUE ("json_object_key"),
        CONSTRAINT "uq_segment_annotation_owner" UNIQUE ("id", "task_segment_asset_id"),
        CONSTRAINT "chk_segment_annotation_revision" CHECK ("revision" >= 1 AND "attempt_count" >= 0),
        CONSTRAINT "chk_segment_annotation_publication" CHECK ("publication_status" IN ('publishing', 'published', 'failed')),
        CONSTRAINT "chk_segment_annotation_source" CHECK ("source_annotation_publication_status" IN ('auto_accepted', 'human_verified')),
        CONSTRAINT "chk_segment_annotation_hashes" CHECK ("video_sha256" ~ '^[a-f0-9]{64}$' AND "json_sha256" ~ '^[a-f0-9]{64}$' AND "source_fingerprint" ~ '^[a-f0-9]{64}$' AND "json_size_bytes" > 0),
        CONSTRAINT "chk_segment_annotation_published_at" CHECK ("publication_status" <> 'published' OR "published_at" IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        ADD COLUMN "storage_layout_version" varchar(80) NOT NULL DEFAULT 'legacy_task_segment_layout_v0',
        ADD COLUMN "current_annotation_revision_id" varchar(64),
        ADD COLUMN "annotation_publication_status" varchar(24) NOT NULL DEFAULT 'pending',
        ADD COLUMN "annotation_publication_attempt_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "annotation_publication_failure_code" varchar(80),
        ADD COLUMN "annotation_publication_failure_message" text,
        ADD COLUMN "annotation_published_at" timestamptz,
        ADD CONSTRAINT "fk_segment_current_annotation" FOREIGN KEY ("current_annotation_revision_id", "id")
          REFERENCES "task_segment_annotation_revisions" ("id", "task_segment_asset_id") ON DELETE RESTRICT,
        ADD CONSTRAINT "chk_segment_annotation_asset_status"
          CHECK ("annotation_publication_status" IN ('not_applicable', 'pending', 'publishing', 'published', 'failed')),
        ADD CONSTRAINT "chk_segment_annotation_asset_attempts" CHECK ("annotation_publication_attempt_count" >= 0),
        ADD CONSTRAINT "chk_segment_annotation_current" CHECK ("annotation_publication_status" <> 'published' OR ("current_annotation_revision_id" IS NOT NULL AND "annotation_published_at" IS NOT NULL))
    `);
    await queryRunner.query(`UPDATE "task_segment_assets" SET "annotation_publication_status" = 'not_applicable' WHERE "generation_status" = 'skipped'`);
    await queryRunner.query(`CREATE INDEX "idx_segment_annotation_pending" ON "task_segment_assets" ("annotation_publication_status", "updated_at", "id")`);
    // Published snapshots are immutable even through direct repository/SQL writes.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "protect_published_segment_annotation"() RETURNS trigger AS $$
      BEGIN
        IF OLD.publication_status = 'published' AND NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'Published task segment annotation revisions are immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`CREATE TRIGGER "segment_annotation_immutable" BEFORE UPDATE ON "task_segment_annotation_revisions" FOR EACH ROW EXECUTE FUNCTION "protect_published_segment_annotation"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        DROP CONSTRAINT "fk_segment_current_annotation",
        DROP CONSTRAINT "chk_segment_annotation_current",
        DROP CONSTRAINT "chk_segment_annotation_asset_status",
        DROP CONSTRAINT "chk_segment_annotation_asset_attempts",
        DROP COLUMN "storage_layout_version",
        DROP COLUMN "current_annotation_revision_id",
        DROP COLUMN "annotation_publication_status",
        DROP COLUMN "annotation_publication_attempt_count",
        DROP COLUMN "annotation_publication_failure_code",
        DROP COLUMN "annotation_publication_failure_message",
        DROP COLUMN "annotation_published_at"
    `);
    await queryRunner.query(`DROP TABLE "task_segment_annotation_revisions"`);
    await queryRunner.query(`DROP FUNCTION "protect_published_segment_annotation"()`);
  }
}
