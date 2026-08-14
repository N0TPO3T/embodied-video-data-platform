import type { MigrationInterface, QueryRunner } from "typeorm";

export class MediaPreviewAssets2026081300008
  implements MigrationInterface
{
  name = "MediaPreviewAssets2026081300008";
  timestamp = 2_026_081_300_008;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "media_metadata" ADD COLUMN "thumbnail_object_key" text',
    );
    await queryRunner.query(
      'ALTER TABLE "media_metadata" ADD COLUMN "preview_object_key" text',
    );
    await queryRunner.query(
      'ALTER TABLE "media_segments" ADD COLUMN "evidence_object_key" text',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "media_segments" DROP COLUMN IF EXISTS "evidence_object_key"',
    );
    await queryRunner.query(
      'ALTER TABLE "media_metadata" DROP COLUMN IF EXISTS "preview_object_key"',
    );
    await queryRunner.query(
      'ALTER TABLE "media_metadata" DROP COLUMN IF EXISTS "thumbnail_object_key"',
    );
  }
}
