import type { MigrationInterface, QueryRunner } from "typeorm";

export class SubmissionDuplicateCandidates2026081300022
  implements MigrationInterface
{
  name = "SubmissionDuplicateCandidates2026081300022";
  timestamp = 2_026_081_300_022;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "submission_duplicate_candidates" (
        "id" varchar(64) PRIMARY KEY,
        "submission_id" varchar(64) NOT NULL,
        "candidate_submission_id" varchar(64) NOT NULL,
        "similarity" numeric(5, 4) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'candidate',
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "cleared_reason" text,
        "cleared_by_account_id" varchar(64),
        "cleared_by_name" varchar(120),
        "cleared_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_submission_duplicate_candidates_status" CHECK ("status" IN ('candidate', 'cleared')),
        CONSTRAINT "chk_submission_duplicate_candidates_similarity" CHECK ("similarity" >= 0 AND "similarity" <= 1),
        CONSTRAINT "chk_submission_duplicate_candidates_distinct" CHECK ("submission_id" <> "candidate_submission_id"),
        CONSTRAINT "fk_submission_duplicate_candidates_submission" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_submission_duplicate_candidates_candidate" FOREIGN KEY ("candidate_submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_submission_duplicate_candidates_unique_pair"
      ON "submission_duplicate_candidates" ("submission_id", "candidate_submission_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_submission_duplicate_candidates_submission"
      ON "submission_duplicate_candidates" ("submission_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_submission_duplicate_candidates_candidate"
      ON "submission_duplicate_candidates" ("candidate_submission_id", "status")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "submission_duplicate_candidates"`);
  }
}
