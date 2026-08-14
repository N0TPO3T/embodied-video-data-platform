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

import { SubmissionEntity } from "./submission.entity.js";

export type SubmissionDuplicateCandidateStatus = "candidate" | "cleared";

@Entity({ name: "submission_duplicate_candidates" })
@Index("idx_submission_duplicate_candidates_submission", [
  "submissionId",
  "status",
])
@Index("idx_submission_duplicate_candidates_candidate", [
  "candidateSubmissionId",
  "status",
])
export class SubmissionDuplicateCandidateEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "submission_id", type: "varchar", length: 64 })
  submissionId!: string;

  @ManyToOne(() => SubmissionEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "submission_id" })
  submission?: SubmissionEntity;

  @Column({ name: "candidate_submission_id", type: "varchar", length: 64 })
  candidateSubmissionId!: string;

  @ManyToOne(() => SubmissionEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "candidate_submission_id" })
  candidateSubmission?: SubmissionEntity;

  @Column({ type: "numeric", precision: 5, scale: 4 })
  similarity!: string;

  @Column({ type: "varchar", length: 24, default: "candidate" })
  status: SubmissionDuplicateCandidateStatus = "candidate";

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  details!: Record<string, unknown>;

  @Column({ name: "cleared_reason", type: "text", nullable: true })
  clearedReason: string | null = null;

  @Column({
    name: "cleared_by_account_id",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  clearedByAccountId: string | null = null;

  @Column({ name: "cleared_by_name", type: "varchar", length: 120, nullable: true })
  clearedByName: string | null = null;

  @Column({ name: "cleared_at", type: "timestamptz", nullable: true })
  clearedAt: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
