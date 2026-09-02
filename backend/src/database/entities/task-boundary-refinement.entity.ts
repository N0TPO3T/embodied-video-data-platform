import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { AnnotationRunEntity } from "./annotation-run.entity.js";
import { SubmissionEntity } from "./submission.entity.js";

export type TaskBoundarySideStatus =
  | "refined"
  | "unchanged"
  | "not_observable"
  | "failed";

export type TaskBoundaryRefinementExecutionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "fallback"
  | "system_failed";

@Entity({ name: "task_boundary_refinements" })
@Index(
  "uq_task_boundary_refinements_run_task_policy",
  ["annotationRunId", "taskIndex", "policyVersion"],
  { unique: true },
)
@Index("idx_task_boundary_refinements_submission_status", [
  "submissionId",
  "executionStatus",
  "createdAt",
])
export class TaskBoundaryRefinementEntity {
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

  @Column({ name: "policy_version", type: "varchar", length: 80 })
  policyVersion!: string;

  @Column({ name: "prompt_version", type: "varchar", length: 80 })
  promptVersion!: string;

  @Column({ name: "model_version", type: "varchar", length: 120 })
  modelVersion!: string;

  @Column({ name: "coarse_start_ms", type: "double precision" })
  coarseStartMs!: number;

  @Column({ name: "coarse_end_ms", type: "double precision" })
  coarseEndMs!: number;

  @Column({ name: "refined_start_ms", type: "double precision", nullable: true })
  refinedStartMs: number | null = null;

  @Column({ name: "refined_end_ms", type: "double precision", nullable: true })
  refinedEndMs: number | null = null;

  @Column({ name: "start_status", type: "varchar", length: 24 })
  startStatus!: TaskBoundarySideStatus;

  @Column({ name: "end_status", type: "varchar", length: 24 })
  endStatus!: TaskBoundarySideStatus;

  @Column({ name: "start_reason_code", type: "varchar", length: 80, nullable: true })
  startReasonCode: string | null = null;

  @Column({ name: "end_reason_code", type: "varchar", length: 80, nullable: true })
  endReasonCode: string | null = null;

  @Column({ name: "sample_manifest", type: "jsonb", nullable: true })
  sampleManifest: unknown = null;

  @Column({ name: "raw_model_output", type: "jsonb", nullable: true })
  rawModelOutput: unknown = null;

  @Column({ name: "validation_issues", type: "jsonb", default: () => "'[]'::jsonb" })
  validationIssues: unknown = [];

  @Column({ name: "input_tokens", type: "integer", nullable: true })
  inputTokens: number | null = null;

  @Column({ name: "output_tokens", type: "integer", nullable: true })
  outputTokens: number | null = null;

  @Column({ name: "model_latency_ms", type: "integer", nullable: true })
  modelLatencyMs: number | null = null;

  @Column({ name: "execution_status", type: "varchar", length: 24 })
  executionStatus!: TaskBoundaryRefinementExecutionStatus;

  @Column({ name: "failure_code", type: "varchar", length: 80, nullable: true })
  failureCode: string | null = null;

  @Column({ name: "failure_message", type: "text", nullable: true })
  failureMessage: string | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null = null;
}
