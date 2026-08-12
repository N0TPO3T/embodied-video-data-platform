import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

import { SubmissionEntity } from "./submission.entity.js";
import { VideoQualityPromptVersionEntity } from "./video-quality-prompt-version.entity.js";

export type VideoQualityResultStatus =
  | "queued"
  | "running"
  | "scored"
  | "hard_reject"
  | "review_pending"
  | "system_failed";

@Entity({ name: "video_quality_results" })
export class VideoQualityResultEntity {
  @PrimaryColumn({ name: "submission_id", type: "varchar", length: 64 })
  submissionId!: string;

  @OneToOne(() => SubmissionEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "submission_id" })
  submission?: SubmissionEntity;

  @Column({ type: "varchar", length: 24 })
  status!: VideoQualityResultStatus;

  @Column({ type: "integer", default: 0 })
  attempts = 0;

  @Column({ name: "prompt_version_id", type: "varchar", length: 64 })
  promptVersionId!: string;

  @OneToOne(() => VideoQualityPromptVersionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "prompt_version_id" })
  prompt?: VideoQualityPromptVersionEntity;

  @Column({ name: "prompt_revision", type: "integer" })
  promptRevision!: number;

  @Column({ name: "prompt_content_sha256", type: "char", length: 64 })
  promptContentSha256!: string;

  @Column({ name: "system_prompt_snapshot", type: "text" })
  systemPromptSnapshot!: string;

  @Column({ name: "initial_model", type: "varchar", length: 120 })
  initialModel!: string;

  @Column({ name: "review_model", type: "varchar", length: 120 })
  reviewModel!: string;

  @Column({ name: "model_runs", type: "jsonb", default: () => "'[]'::jsonb" })
  modelRuns: Array<Record<string, unknown>> = [];

  @Column({ name: "final_score", type: "numeric", precision: 6, scale: 1, nullable: true })
  finalScore: string | null = null;

  @Column({ name: "raw_total_score", type: "numeric", precision: 6, scale: 1, nullable: true })
  rawTotalScore: string | null = null;

  @Column({ name: "settlement_ratio", type: "numeric", precision: 6, scale: 4, nullable: true })
  settlementRatio: string | null = null;

  @Column({ name: "invalid_duration_ms", type: "bigint", nullable: true })
  invalidDurationMs: string | null = null;

  @Column({ name: "billable_duration_ms", type: "bigint", nullable: true })
  billableDurationMs: string | null = null;

  @Column({ type: "text", default: "" })
  summary = "";

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  recommendations: string[] = [];

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  deductions: Array<Record<string, unknown>> = [];

  @Column({ name: "review_required", type: "boolean", default: false })
  reviewRequired = false;

  @Column({ name: "review_reasons", type: "jsonb", default: () => "'[]'::jsonb" })
  reviewReasons: string[] = [];

  @Column({ name: "normalized_result", type: "jsonb", nullable: true })
  normalizedResult: Record<string, unknown> | null = null;

  @Column({ name: "raw_model_result", type: "jsonb", nullable: true })
  rawModelResult: Record<string, unknown> | null = null;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null = null;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null = null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
