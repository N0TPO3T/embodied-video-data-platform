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

import { TeamEntity } from "./team.entity.js";
import { UserEntity } from "./user.entity.js";

export type UploadStatus =
  | "created"
  | "uploading"
  | "uploaded"
  | "aborted";

export type SubmissionProcessingStatus =
  | "uploading"
  | "queued"
  | "probing"
  | "awaiting_ai"
  | "completed"
  | "system_failed";

@Entity({ name: "submissions" })
@Index("idx_submissions_owner_created", ["ownerId", "createdAt"])
@Index("idx_submissions_team_created", ["teamId", "createdAt"])
@Index("idx_submissions_processing_status", ["processingStatus"])
export class SubmissionEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "owner_id", type: "varchar", length: 64 })
  ownerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "owner_id" })
  owner?: UserEntity;

  @Column({ name: "team_id", type: "varchar", length: 64 })
  teamId!: string;

  @ManyToOne(() => TeamEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "team_id" })
  team?: TeamEntity;

  @Column({ name: "original_file_name", type: "varchar", length: 255 })
  originalFileName!: string;

  @Column({ name: "content_type", type: "varchar", length: 64 })
  contentType!: string;

  @Column({ name: "expected_size_bytes", type: "bigint" })
  expectedSizeBytes!: string;

  @Column({ name: "checksum_sha256", type: "char", length: 64 })
  checksumSha256!: string;

  @Index("idx_submissions_object_key", { unique: true })
  @Column({ name: "object_key", type: "text" })
  objectKey!: string;

  @Column({ name: "multipart_upload_id", type: "text", nullable: true })
  multipartUploadId: string | null = null;

  @Column({ name: "upload_status", type: "varchar", length: 16 })
  uploadStatus!: UploadStatus;

  @Column({ name: "processing_status", type: "varchar", length: 24 })
  processingStatus!: SubmissionProcessingStatus;

  @Column({ name: "failure_code", type: "varchar", length: 64, nullable: true })
  failureCode: string | null = null;

  @Column({ name: "failure_message", type: "text", nullable: true })
  failureMessage: string | null = null;

  @Column({ name: "is_test_data", type: "boolean", default: false })
  isTestData = false;

  @Column({ name: "uploaded_at", type: "timestamptz", nullable: true })
  uploadedAt: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
