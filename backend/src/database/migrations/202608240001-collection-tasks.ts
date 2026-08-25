import type { MigrationInterface, QueryRunner } from "typeorm";

export class CollectionTasks2026082400001 implements MigrationInterface {
  name = "CollectionTasks2026082400001";
  timestamp = 2_026_082_400_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "collection_tasks" (
        "id" varchar(64) NOT NULL,
        "title" varchar(120) NOT NULL,
        "description" text NOT NULL,
        "scene_name" varchar(120) NOT NULL,
        "scene_label_id" varchar(64),
        "raw_requirements" text NOT NULL,
        "normalized_requirements" jsonb,
        "normalization_status" varchar(24) NOT NULL DEFAULT 'pending',
        "price_points_per_minute" numeric(10, 2),
        "status" varchar(16) NOT NULL DEFAULT 'draft',
        "revision" integer NOT NULL DEFAULT 1,
        "created_by_account_id" varchar(64) NOT NULL,
        "created_by_name" varchar(120) NOT NULL,
        "published_at" timestamptz,
        "paused_at" timestamptz,
        "closed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_collection_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "fk_collection_tasks_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_collection_tasks_status" ON "collection_tasks" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_collection_tasks_scene_name" ON "collection_tasks" ("scene_name")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_collection_tasks_created_by" ON "collection_tasks" ("created_by_account_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions"
        ADD COLUMN "task_id" varchar(64),
        ADD COLUMN "task_revision" integer,
        ADD COLUMN "task_scene_name" varchar(120),
        ADD COLUMN "task_requirements_snapshot" jsonb,
        ADD COLUMN "task_price_points_per_minute" numeric(10, 2)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_submissions_task_id" ON "submissions" ("task_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions" ADD CONSTRAINT "fk_submissions_task"
        FOREIGN KEY ("task_id") REFERENCES "collection_tasks" ("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "point_cycle_items"
        ADD COLUMN "task_id" varchar(64),
        ADD COLUMN "task_name" varchar(120),
        ADD COLUMN "task_scene_name" varchar(120),
        ADD COLUMN "price_points_per_minute" numeric(10, 2)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "point_cycle_items"
        DROP COLUMN IF EXISTS "task_id",
        DROP COLUMN IF EXISTS "task_name",
        DROP COLUMN IF EXISTS "task_scene_name",
        DROP COLUMN IF EXISTS "price_points_per_minute"
    `);
    await queryRunner.query(
      'ALTER TABLE "submissions" DROP CONSTRAINT IF EXISTS "fk_submissions_task"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_submissions_task_id"',
    );
    await queryRunner.query(`
      ALTER TABLE "submissions"
        DROP COLUMN IF EXISTS "task_id",
        DROP COLUMN IF EXISTS "task_revision",
        DROP COLUMN IF EXISTS "task_scene_name",
        DROP COLUMN IF EXISTS "task_requirements_snapshot",
        DROP COLUMN IF EXISTS "task_price_points_per_minute"
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_collection_tasks_created_by"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_collection_tasks_scene_name"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_collection_tasks_status"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "collection_tasks"');
  }
}
