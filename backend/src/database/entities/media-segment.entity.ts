import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { SubmissionEntity } from "./submission.entity.js";

export type MediaSegmentType = "black" | "freeze";

@Entity({ name: "media_segments" })
@Index("idx_media_segments_submission_start", [
  "submissionId",
  "startSeconds",
])
export class MediaSegmentEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "submission_id", type: "varchar", length: 64 })
  submissionId!: string;

  @ManyToOne(() => SubmissionEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "submission_id" })
  submission?: SubmissionEntity;

  @Column({ type: "varchar", length: 16 })
  type!: MediaSegmentType;

  @Column({
    name: "start_seconds",
    type: "numeric",
    precision: 14,
    scale: 3,
  })
  startSeconds!: string;

  @Column({
    name: "end_seconds",
    type: "numeric",
    precision: 14,
    scale: 3,
  })
  endSeconds!: string;

  @Column({ type: "boolean", default: true })
  invalid = true;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  details: Record<string, unknown> = {};

  @Column({ name: "evidence_object_key", type: "text", nullable: true })
  evidenceObjectKey: string | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
