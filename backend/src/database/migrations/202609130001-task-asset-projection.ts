import type { MigrationInterface, QueryRunner } from "typeorm";

export class TaskAssetProjection2026091300001 implements MigrationInterface {
  name = "TaskAssetProjection2026091300001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE task_segment_asset_projections (
        asset_id varchar(64) PRIMARY KEY REFERENCES task_segment_assets(id) ON DELETE RESTRICT,
        current_annotation_revision_id varchar(64) NOT NULL
          CONSTRAINT uq_task_asset_projection_revision UNIQUE
          REFERENCES task_segment_annotation_revisions(id) ON DELETE RESTRICT,
        projection_version text NOT NULL,
        source_group_id text NOT NULL,
        scene_group_key text NOT NULL,
        scene_mapping_status text NOT NULL,
        primary_scene_id text,
        primary_scene_name text,
        scene_coarse_label text,
        scene_fine_label text,
        scene_verification text NOT NULL,
        task_description text NOT NULL,
        task_verb text NOT NULL,
        task_mapping_status text NOT NULL,
        task_label_id text,
        task_label_name text,
        task_object_raw text NOT NULL,
        object_label_ids text[] NOT NULL DEFAULT '{}'::text[],
        object_label_names text[] NOT NULL DEFAULT '{}'::text[],
        object_raw_texts text[] NOT NULL DEFAULT '{}'::text[],
        tool_label_ids text[] NOT NULL DEFAULT '{}'::text[],
        tool_label_names text[] NOT NULL DEFAULT '{}'::text[],
        tool_raw_texts text[] NOT NULL DEFAULT '{}'::text[],
        interaction_primitives text[] NOT NULL DEFAULT '{}'::text[],
        complexity_signals text[] NOT NULL DEFAULT '{}'::text[],
        proposed_object_count integer NOT NULL,
        unmapped_object_count integer NOT NULL,
        proposed_tool_count integer NOT NULL,
        unmapped_tool_count integer NOT NULL,
        warning_count integer NOT NULL,
        hand_mode text NOT NULL,
        execution_pattern text NOT NULL,
        evidence_level text NOT NULL,
        model_completion text NOT NULL,
        effective_completion text NOT NULL,
        model_result_status text NOT NULL,
        effective_result_status text NOT NULL,
        effective_failure_recovery text NOT NULL,
        semantic_verification text NOT NULL,
        source_annotation_acceptance text NOT NULL,
        boundary_source text NOT NULL,
        search_text text NOT NULL,
        has_uncertainty boolean NOT NULL,
        has_unmapped_labels boolean NOT NULL,
        object_labels jsonb NOT NULL,
        tool_labels jsonb NOT NULL,
        CONSTRAINT fk_task_asset_projection_revision_owner FOREIGN KEY (current_annotation_revision_id, asset_id)
          REFERENCES task_segment_annotation_revisions(id, task_segment_asset_id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (scene_mapping_status IN ('matched', 'proposed', 'unknown')),
        CHECK (task_mapping_status IN ('matched', 'proposed', 'unknown')),
        CHECK (proposed_object_count >= 0 AND unmapped_object_count >= proposed_object_count),
        CHECK (proposed_tool_count >= 0 AND unmapped_tool_count >= proposed_tool_count),
        CHECK (warning_count >= 0)
      )
    `);
    for (const column of [
      "primary_scene_id", "scene_group_key", "scene_mapping_status", "task_verb",
      "task_label_id", "hand_mode", "execution_pattern", "effective_completion",
      "effective_result_status", "effective_failure_recovery", "semantic_verification",
      "source_annotation_acceptance", "boundary_source", "source_group_id",
      "has_uncertainty", "has_unmapped_labels", "updated_at",
    ]) {
      await queryRunner.query(`CREATE INDEX idx_tap_${column} ON task_segment_asset_projections (${column})`);
    }
    for (const column of ["object_label_ids", "tool_label_ids", "interaction_primitives", "complexity_signals"]) {
      await queryRunner.query(`CREATE INDEX idx_tap_${column} ON task_segment_asset_projections USING gin (${column})`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE task_segment_asset_projections");
  }
}
