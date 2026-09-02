import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

import { AnnotationRunEntity } from "./annotation-run.entity.js";
import { SubmissionEntity } from "./submission.entity.js";

export type TaskSegmentGenerationStatus =
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "skipped";

export type TaskSegmentBoundarySource =
  | "coarse"
  | "refined"
  | "coarse_fallback";

export type TaskSegmentMaterializationMode =
  | "stream_copy"
  | "exact_clip_transcode";

export type TaskSegmentValidationStatus = "pending" | "passed" | "failed";

@Entity({ name: "task_segment_assets" })
@Index("uq_task_segment_assets_run_task", ["annotationRunId", "taskIndex"], {
  unique: true,
})
@Index("idx_task_segment_assets_submission_created", ["submissionId", "createdAt", "id"])
@Index("idx_task_segment_assets_status_created", ["generationStatus", "createdAt", "id"])
export class TaskSegmentAssetEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "submission_id", type: "varchar", length: 64 })
  submissionId!: string;

  @ManyToOne(() => SubmissionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "submission_id" })
  submission?: SubmissionEntity;

  @Column({ name: "annotation_run_id", type: "varchar", length: 64 })
  annotationRunId!: string;

  @ManyToOne(() => AnnotationRunEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "annotation_run_id" })
  annotationRun?: AnnotationRunEntity;

  @Column({ name: "task_index", type: "integer" })
  taskIndex!: number;

  @Column({ name: "pipeline_version", type: "varchar", length: 80 })
  pipelineVersion!: string;

  @Column({ name: "prompt_version", type: "varchar", length: 120 })
  promptVersion!: string;

  @Column({ name: "schema_version", type: "varchar", length: 80 })
  schemaVersion!: string;

  @Column({ name: "evidence_policy_version", type: "varchar", length: 80 })
  evidencePolicyVersion!: string;

  @Column({ name: "ontology_version", type: "varchar", length: 80, nullable: true })
  ontologyVersion: string | null = null;

  @Column({ name: "task_label", type: "varchar", length: 200 })
  taskLabel!: string;

  @Column({ name: "task_verb", type: "varchar", length: 80 })
  taskVerb!: string;

  @Column({ type: "varchar", length: 32 })
  completion!: string;

  @Column({ name: "result_status", type: "varchar", length: 32 })
  resultStatus!: string;

  @Column({ name: "source_start_ms", type: "double precision" })
  sourceStartMs!: number;

  @Column({ name: "source_end_ms", type: "double precision" })
  sourceEndMs!: number;

  @Column({ name: "boundary_refinement_id", type: "varchar", length: 64, nullable: true })
  boundaryRefinementId: string | null = null;

  @Column({ name: "refined_start_ms", type: "double precision", nullable: true })
  refinedStartMs: number | null = null;

  @Column({ name: "refined_end_ms", type: "double precision", nullable: true })
  refinedEndMs: number | null = null;

  @Column({ name: "boundary_source", type: "varchar", length: 24, default: "coarse" })
  boundarySource: TaskSegmentBoundarySource = "coarse";

  @Column({
    name: "boundary_refinement_policy_version",
    type: "varchar",
    length: 80,
    nullable: true,
  })
  boundaryRefinementPolicyVersion: string | null = null;

  @Column({ name: "clip_start_ms", type: "double precision" })
  clipStartMs!: number;

  @Column({ name: "clip_end_ms", type: "double precision" })
  clipEndMs!: number;

  @Column({ name: "requested_start_ms", type: "double precision" })
  requestedStartMs!: number;

  @Column({ name: "requested_end_ms", type: "double precision" })
  requestedEndMs!: number;

  @Column({ name: "actual_start_ms", type: "double precision", nullable: true })
  actualStartMs: number | null = null;

  @Column({ name: "actual_end_ms", type: "double precision", nullable: true })
  actualEndMs: number | null = null;

  @Column({
    name: "materialization_policy_version",
    type: "varchar",
    length: 80,
  })
  materializationPolicyVersion!: string;

  @Column({ name: "materialization_mode", type: "varchar", length: 32 })
  materializationMode: TaskSegmentMaterializationMode = "stream_copy";

  @Column({ name: "source_codec", type: "varchar", length: 64, nullable: true })
  sourceCodec: string | null = null;

  @Column({ name: "source_nominal_fps", type: "double precision", nullable: true })
  sourceNominalFps: number | null = null;

  @Column({ name: "source_has_audio", type: "boolean", nullable: true })
  sourceHasAudio: boolean | null = null;

  @Column({ name: "source_duration_ms", type: "integer", nullable: true })
  sourceDurationMs: number | null = null;

  @Column({ name: "requested_duration_ms", type: "integer", nullable: true })
  requestedDurationMs: number | null = null;

  @Column({ name: "predicted_copy_start_ms", type: "double precision", nullable: true })
  predictedCopyStartMs: number | null = null;

  @Column({ name: "keyframe_distance_start_ms", type: "double precision", nullable: true })
  keyframeDistanceStartMs: number | null = null;

  @Column({ name: "boundary_tolerance_ms", type: "double precision", nullable: true })
  boundaryToleranceMs: number | null = null;

  @Column({ name: "start_drift_ms", type: "double precision", nullable: true })
  startDriftMs: number | null = null;

  @Column({ name: "end_drift_ms", type: "double precision", nullable: true })
  endDriftMs: number | null = null;

  @Column({ name: "validation_status", type: "varchar", length: 24 })
  validationStatus: TaskSegmentValidationStatus = "pending";

  @Column({ name: "validation_failure_code", type: "varchar", length: 80, nullable: true })
  validationFailureCode: string | null = null;

  @Column({ name: "validation_failure_message", type: "text", nullable: true })
  validationFailureMessage: string | null = null;

  @Column({ name: "stream_copy_attempted", type: "boolean", default: false })
  streamCopyAttempted = false;

  @Column({ name: "copy_rejected_reason", type: "varchar", length: 120, nullable: true })
  copyRejectedReason: string | null = null;

  @Column({ name: "transcoded_input_duration_ms", type: "integer", nullable: true })
  transcodedInputDurationMs: number | null = null;

  @Column({ name: "materialization_started_at", type: "timestamptz", nullable: true })
  materializationStartedAt: Date | null = null;

  @Column({ name: "materialization_completed_at", type: "timestamptz", nullable: true })
  materializationCompletedAt: Date | null = null;

  @Column({ name: "materialization_duration_ms", type: "integer", nullable: true })
  materializationDurationMs: number | null = null;

  @Column({ name: "coverage_snapshot", type: "jsonb" })
  coverageSnapshot!: unknown;

  @Column({ name: "evidence_snapshot", type: "jsonb" })
  evidenceSnapshot!: unknown;

  @Column({ name: "validation_warnings", type: "jsonb", default: () => "'[]'::jsonb" })
  validationWarnings: string[] = [];

  @Column({ name: "source_object_key", type: "text" })
  sourceObjectKey!: string;

  @Column({ name: "source_sha256", type: "char", length: 64 })
  sourceSha256!: string;

  @Column({ name: "clip_object_key", type: "text", nullable: true })
  clipObjectKey: string | null = null;

  @Column({ name: "clip_sha256", type: "char", length: 64, nullable: true })
  clipSha256: string | null = null;

  @Column({ name: "clip_size_bytes", type: "bigint", nullable: true })
  clipSizeBytes: string | null = null;

  @Column({ name: "clip_duration_ms", type: "integer", nullable: true })
  clipDurationMs: number | null = null;

  @Column({ type: "varchar", length: 64, nullable: true })
  codec: string | null = null;

  @Column({ type: "integer", nullable: true })
  width: number | null = null;

  @Column({ type: "integer", nullable: true })
  height: number | null = null;

  @Column({ name: "frame_rate", type: "double precision", nullable: true })
  frameRate: number | null = null;

  @Column({ name: "has_audio", type: "boolean", nullable: true })
  hasAudio: boolean | null = null;

  @Column({ name: "generation_status", type: "varchar", length: 24 })
  generationStatus!: TaskSegmentGenerationStatus;

  @Column({ name: "attempt_count", type: "integer", default: 0 })
  attemptCount = 0;

  @Column({ name: "failure_code", type: "varchar", length: 80, nullable: true })
  failureCode: string | null = null;

  @Column({ name: "failure_message", type: "text", nullable: true })
  failureMessage: string | null = null;

  @Column({ name: "usage_status", type: "varchar", length: 24, default: "internal_only" })
  usageStatus: "internal_only" = "internal_only";

  @Column({ name: "generation_policy_version", type: "varchar", length: 80 })
  generationPolicyVersion!: string;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null = null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
