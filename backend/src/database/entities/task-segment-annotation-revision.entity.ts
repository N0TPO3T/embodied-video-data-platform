import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from "typeorm";
import { TaskSegmentAssetEntity } from "./task-segment-asset.entity.js";

@Entity({ name: "task_segment_annotation_revisions" })
@Index("uq_segment_annotation_revision", ["taskSegmentAssetId", "revision"], { unique: true })
@Index("uq_segment_annotation_fingerprint", ["taskSegmentAssetId", "sourceFingerprint"], { unique: true })
@Index("uq_segment_annotation_object", ["jsonObjectKey"], { unique: true })
export class TaskSegmentAnnotationRevisionEntity {
  @PrimaryColumn({ name: "id", type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "task_segment_asset_id", type: "varchar", length: 64 })
  taskSegmentAssetId!: string;

  @Column({ name: "revision", type: "integer" })
  revision!: number;

  @Column({ name: "schema_version", type: "varchar", length: 80 })
  schemaVersion!: string;

  @Column({ name: "taxonomy_version", type: "varchar", length: 120, nullable: true })
  taxonomyVersion: string | null = null;

  @Column({ name: "source_annotation_run_id", type: "varchar", length: 64 })
  sourceAnnotationRunId!: string;

  @Column({ name: "source_annotation_review_revision", type: "integer" })
  sourceAnnotationReviewRevision!: number;

  @Column({ name: "source_annotation_publication_status", type: "varchar", length: 24 })
  sourceAnnotationPublicationStatus!: "auto_accepted" | "human_verified";

  @Column({ name: "boundary_refinement_policy_version", type: "varchar", length: 80, nullable: true })
  boundaryRefinementPolicyVersion: string | null = null;

  @Column({ name: "materialization_policy_version", type: "varchar", length: 80 })
  materializationPolicyVersion!: string;

  @Column({ name: "video_sha256", type: "char", length: 64 })
  videoSha256!: string;

  @Column({ name: "source_fingerprint", type: "char", length: 64 })
  sourceFingerprint!: string;

  @Column({ name: "json_object_key", type: "text" })
  jsonObjectKey!: string;

  @Column({ name: "json_sha256", type: "char", length: 64 })
  jsonSha256!: string;

  @Column({ name: "json_size_bytes", type: "bigint" })
  jsonSizeBytes!: string;

  @Column({ name: "content_json", type: "jsonb" })
  contentJson!: Record<string, unknown>;

  @Column({ name: "canonical_json", type: "text" })
  canonicalJson!: string;

  @Column({ name: "publication_status", type: "varchar", length: 24 })
  publicationStatus!: "publishing" | "published" | "failed";

  @Column({ name: "attempt_count", type: "integer" })
  attemptCount!: number;

  @Column({ name: "failure_code", type: "varchar", length: 80, nullable: true })
  failureCode: string | null = null;

  @Column({ name: "failure_message", type: "text", nullable: true })
  failureMessage: string | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt: Date | null = null;

  @ManyToOne(() => TaskSegmentAssetEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "task_segment_asset_id" })
  asset?: Relation<TaskSegmentAssetEntity>;
}
