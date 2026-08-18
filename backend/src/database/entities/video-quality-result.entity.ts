import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

import { SubmissionEntity } from "./submission.entity.js";
import { LabelSetVersionEntity } from "./label-set-version.entity.js";
import { QualityRuleVersionEntity } from "./quality-rule-version.entity.js";
import { VideoQualityPromptVersionEntity } from "./video-quality-prompt-version.entity.js";
import type {
  LabelSetSnapshot,
  QualityRuleSnapshot,
} from "../../rules/rule-calculator.js";

export type VideoQualityResultStatus =
  | "queued"
  | "running"
  | "scored"
  | "hard_reject"
  | "review_pending"
  | "stuck"
  | "system_failed";

export type VideoQualityProgressStage =
  | "queued"
  | "downloading"
  | "media_analysis"
  | "initial_review"
  | "secondary_review"
  | "completed"
  | "failed"
  | "stuck";

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

  @ManyToOne(() => VideoQualityPromptVersionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "prompt_version_id" })
  prompt?: VideoQualityPromptVersionEntity;

  @Column({ name: "prompt_revision", type: "integer" })
  promptRevision!: number;

  @Column({ name: "prompt_content_sha256", type: "char", length: 64 })
  promptContentSha256!: string;

  @Column({ name: "system_prompt_snapshot", type: "text" })
  systemPromptSnapshot!: string;

  @Column({ name: "quality_rule_version_id", type: "varchar", length: 64, nullable: true })
  qualityRuleVersionId: string | null = null;

  @ManyToOne(() => QualityRuleVersionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "quality_rule_version_id" })
  qualityRule?: QualityRuleVersionEntity;

  @Column({ name: "quality_rule_revision", type: "integer", nullable: true })
  qualityRuleRevision: number | null = null;

  @Column({ name: "label_set_version_id", type: "varchar", length: 64, nullable: true })
  labelSetVersionId: string | null = null;

  @ManyToOne(() => LabelSetVersionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "label_set_version_id" })
  labelSet?: LabelSetVersionEntity;

  @Column({ name: "label_set_revision", type: "integer", nullable: true })
  labelSetRevision: number | null = null;

  @Column({ name: "quality_rule_snapshot", type: "jsonb", nullable: true })
  qualityRuleSnapshot: QualityRuleSnapshot | null = null;

  @Column({ name: "label_set_snapshot", type: "jsonb", nullable: true })
  labelSetSnapshot: LabelSetSnapshot | null = null;

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

  @Column({ name: "passed", type: "boolean", nullable: true })
  passed: boolean | null = null;

  @Column({ name: "invalid_duration_ms", type: "bigint", nullable: true })
  invalidDurationMs: string | null = null;

  @Column({ name: "billable_duration_ms", type: "bigint", nullable: true })
  billableDurationMs: string | null = null;

  @Column({ name: "manual_final_score", type: "numeric", precision: 6, scale: 1, nullable: true })
  manualFinalScore: string | null = null;

  @Column({ name: "manual_settlement_ratio", type: "numeric", precision: 6, scale: 4, nullable: true })
  manualSettlementRatio: string | null = null;

  @Column({ name: "manual_invalid_duration_ms", type: "bigint", nullable: true })
  manualInvalidDurationMs: string | null = null;

  @Column({ name: "manual_billable_duration_ms", type: "bigint", nullable: true })
  manualBillableDurationMs: string | null = null;

  @Column({ name: "manual_issues", type: "jsonb", nullable: true })
  manualIssues: Array<Record<string, unknown>> | null = null;

  @Column({ name: "manual_review_reason", type: "text", nullable: true })
  manualReviewReason: string | null = null;

  @Column({ name: "manual_reviewed_by_account_id", type: "varchar", length: 64, nullable: true })
  manualReviewedByAccountId: string | null = null;

  @Column({ name: "manual_reviewed_by_name", type: "varchar", length: 120, nullable: true })
  manualReviewedByName: string | null = null;

  @Column({ name: "manual_reviewed_at", type: "timestamptz", nullable: true })
  manualReviewedAt: Date | null = null;

  @Column({ name: "review_revision", type: "integer", default: 0 })
  reviewRevision = 0;

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

  @Column({ name: "progress_stage", type: "varchar", length: 32, nullable: true })
  progressStage: VideoQualityProgressStage | null = null;

  @Column({ name: "progress_updated_at", type: "timestamptz", nullable: true })
  progressUpdatedAt: Date | null = null;

  @Column({ name: "stuck_reason", type: "text", nullable: true })
  stuckReason: string | null = null;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null = null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
