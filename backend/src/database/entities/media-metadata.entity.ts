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

@Entity({ name: "media_metadata" })
export class MediaMetadataEntity {
  @PrimaryColumn({ name: "submission_id", type: "varchar", length: 64 })
  submissionId!: string;

  @OneToOne(() => SubmissionEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "submission_id" })
  submission?: SubmissionEntity;

  @Column({
    name: "duration_seconds",
    type: "numeric",
    precision: 14,
    scale: 3,
  })
  durationSeconds!: string;

  @Column({ type: "integer" })
  width!: number;

  @Column({ type: "integer" })
  height!: number;

  @Column({
    name: "frame_rate",
    type: "numeric",
    precision: 10,
    scale: 3,
  })
  frameRate!: string;

  @Column({ type: "varchar", length: 64 })
  codec!: string;

  @Column({ type: "bigint", nullable: true })
  bitrate: string | null = null;

  @Column({ name: "size_bytes", type: "bigint" })
  sizeBytes!: string;

  @Column({ name: "raw_probe", type: "jsonb" })
  rawProbe!: Record<string, unknown>;

  @Column({ name: "thumbnail_object_key", type: "text", nullable: true })
  thumbnailObjectKey: string | null = null;

  @Column({ name: "preview_object_key", type: "text", nullable: true })
  previewObjectKey: string | null = null;

  @Column({ name: "hls_master_object_key", type: "text", nullable: true })
  hlsMasterObjectKey: string | null = null;

  @Column({ name: "hls_base_object_key", type: "text", nullable: true })
  hlsBaseObjectKey: string | null = null;

  @Column({ name: "hls_qualities", type: "jsonb", default: () => "'[]'::jsonb" })
  hlsQualities: Array<{ quality: string; width: number; height: number }> = [];

  @Column({ name: "hls_object_keys", type: "jsonb", default: () => "'[]'::jsonb" })
  hlsObjectKeys: string[] = [];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
