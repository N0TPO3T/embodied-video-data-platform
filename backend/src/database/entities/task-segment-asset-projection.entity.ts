import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn, type Relation } from "typeorm";
import { TaskSegmentAssetEntity } from "./task-segment-asset.entity.js";
import { TaskSegmentAnnotationRevisionEntity } from "./task-segment-annotation-revision.entity.js";

// Paired labels preserve ID/name association for facets; independently sorted
// ID/name arrays must never be zipped. Null IDs are readable, unmapped text.
export type TaskAssetLabel = { id: string | null; name: string };

@Entity({ name: "task_segment_asset_projections" })
@Index("uq_task_asset_projection_revision", ["currentAnnotationRevisionId"], { unique: true })
export class TaskSegmentAssetProjectionEntity {
  @PrimaryColumn({ name: "asset_id", type: "varchar", length: 64 })
  assetId!: string;

  @Column({ name: "current_annotation_revision_id", type: "varchar", length: 64 })
  currentAnnotationRevisionId!: string;

  @Column({ name: "projection_version", type: "text" })
  projectionVersion!: string;

  @Column({ name: "source_group_id", type: "text" })
  sourceGroupId!: string;

  @Column({ name: "scene_group_key", type: "text" })
  sceneGroupKey!: string;

  @Column({ name: "scene_mapping_status", type: "text" })
  sceneMappingStatus!: string;

  @Column({ name: "primary_scene_id", type: "text", nullable: true })
  primarySceneId!: string | null;

  @Column({ name: "primary_scene_name", type: "text", nullable: true })
  primarySceneName!: string | null;

  @Column({ name: "scene_coarse_label", type: "text", nullable: true })
  sceneCoarseLabel!: string | null;

  @Column({ name: "scene_fine_label", type: "text", nullable: true })
  sceneFineLabel!: string | null;

  @Column({ name: "scene_verification", type: "text" })
  sceneVerification!: string;

  @Column({ name: "task_description", type: "text" })
  taskDescription!: string;

  @Column({ name: "task_verb", type: "text" })
  taskVerb!: string;

  @Column({ name: "task_mapping_status", type: "text" })
  taskMappingStatus!: string;

  @Column({ name: "task_label_id", type: "text", nullable: true })
  taskLabelId!: string | null;

  @Column({ name: "task_label_name", type: "text", nullable: true })
  taskLabelName!: string | null;

  @Column({ name: "task_object_raw", type: "text" })
  taskObjectRaw!: string;

  @Column({ name: "object_label_ids", type: "text", array: true, default: () => "'{}'::text[]" })
  objectLabelIds!: string[];

  @Column({ name: "object_label_names", type: "text", array: true, default: () => "'{}'::text[]" })
  objectLabelNames!: string[];

  @Column({ name: "object_raw_texts", type: "text", array: true, default: () => "'{}'::text[]" })
  objectRawTexts!: string[];

  @Column({ name: "tool_label_ids", type: "text", array: true, default: () => "'{}'::text[]" })
  toolLabelIds!: string[];

  @Column({ name: "tool_label_names", type: "text", array: true, default: () => "'{}'::text[]" })
  toolLabelNames!: string[];

  @Column({ name: "tool_raw_texts", type: "text", array: true, default: () => "'{}'::text[]" })
  toolRawTexts!: string[];

  @Column({ name: "interaction_primitives", type: "text", array: true, default: () => "'{}'::text[]" })
  interactionPrimitives!: string[];

  @Column({ name: "complexity_signals", type: "text", array: true, default: () => "'{}'::text[]" })
  complexitySignals!: string[];

  @Column({ name: "proposed_object_count", type: "integer" })
  proposedObjectCount!: number;

  @Column({ name: "unmapped_object_count", type: "integer" })
  unmappedObjectCount!: number;

  @Column({ name: "proposed_tool_count", type: "integer" })
  proposedToolCount!: number;

  @Column({ name: "unmapped_tool_count", type: "integer" })
  unmappedToolCount!: number;

  @Column({ name: "warning_count", type: "integer" })
  warningCount!: number;

  @Column({ name: "hand_mode", type: "text" })
  handMode!: string;

  @Column({ name: "execution_pattern", type: "text" })
  executionPattern!: string;

  @Column({ name: "evidence_level", type: "text" })
  evidenceLevel!: string;

  @Column({ name: "model_completion", type: "text" })
  modelCompletion!: string;

  @Column({ name: "effective_completion", type: "text" })
  effectiveCompletion!: string;

  @Column({ name: "model_result_status", type: "text" })
  modelResultStatus!: string;

  @Column({ name: "effective_result_status", type: "text" })
  effectiveResultStatus!: string;

  @Column({ name: "effective_failure_recovery", type: "text" })
  effectiveFailureRecovery!: string;

  @Column({ name: "semantic_verification", type: "text" })
  semanticVerification!: string;

  @Column({ name: "source_annotation_acceptance", type: "text" })
  sourceAnnotationAcceptance!: string;

  @Column({ name: "boundary_source", type: "text" })
  boundarySource!: string;

  @Column({ name: "search_text", type: "text" })
  searchText!: string;

  @Column({ name: "has_uncertainty", type: "boolean" })
  hasUncertainty!: boolean;

  @Column({ name: "has_unmapped_labels", type: "boolean" })
  hasUnmappedLabels!: boolean;

  @Column({ name: "object_labels", type: "jsonb" })
  objectLabels!: TaskAssetLabel[];

  @Column({ name: "tool_labels", type: "jsonb" })
  toolLabels!: TaskAssetLabel[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => TaskSegmentAssetEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "asset_id" })
  asset?: Relation<TaskSegmentAssetEntity>;

  @ManyToOne(() => TaskSegmentAnnotationRevisionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "current_annotation_revision_id" })
  revision?: Relation<TaskSegmentAnnotationRevisionEntity>;
}
