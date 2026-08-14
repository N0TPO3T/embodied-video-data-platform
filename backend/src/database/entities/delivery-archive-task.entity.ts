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

import { DeliveryPackageEntity } from "./delivery-package.entity.js";
import { UserEntity } from "./user.entity.js";

export type DeliveryArchiveFormat = "zip" | "tar";
export type DeliveryArchiveStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

@Entity({ name: "delivery_archive_tasks" })
@Index("idx_delivery_archive_tasks_package_created", ["packageId", "createdAt"])
@Index("idx_delivery_archive_tasks_status", ["status"])
@Index("idx_delivery_archive_tasks_claim", ["status", "leaseUntil", "createdAt"])
export class DeliveryArchiveTaskEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "package_id", type: "varchar", length: 64 })
  packageId!: string;

  @ManyToOne(() => DeliveryPackageEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "package_id" })
  package?: DeliveryPackageEntity;

  @Column({ type: "varchar", length: 8 })
  format!: DeliveryArchiveFormat;

  @Column({ type: "varchar", length: 16, default: "queued" })
  status: DeliveryArchiveStatus = "queued";

  @Column({ name: "asset_count", type: "integer" })
  assetCount!: number;

  @Column({ name: "processed_asset_count", type: "integer", default: 0 })
  processedAssetCount = 0;

  @Column({ name: "total_size_bytes", type: "bigint" })
  totalSizeBytes!: string;

  @Column({ name: "processed_size_bytes", type: "bigint", default: "0" })
  processedSizeBytes = "0";

  @Column({ name: "archive_object_key", type: "text", nullable: true })
  archiveObjectKey: string | null = null;

  @Column({ name: "archive_size_bytes", type: "bigint", nullable: true })
  archiveSizeBytes: string | null = null;

  @Column({ name: "file_name", type: "varchar", length: 255 })
  fileName!: string;

  @Column({ name: "failure_message", type: "text", nullable: true })
  failureMessage: string | null = null;

  @Column({ name: "attempt_count", type: "integer", default: 0 })
  attemptCount = 0;

  @Column({ name: "lease_token", type: "varchar", length: 64, nullable: true })
  leaseToken: string | null = null;

  @Column({ name: "lease_owner", type: "varchar", length: 128, nullable: true })
  leaseOwner: string | null = null;

  @Column({ name: "lease_until", type: "timestamptz", nullable: true })
  leaseUntil: Date | null = null;

  @Column({ name: "requested_by_account_id", type: "varchar", length: 64 })
  requestedByAccountId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "requested_by_account_id" })
  requestedBy?: UserEntity;

  @Column({ name: "requested_by_name", type: "varchar", length: 120 })
  requestedByName!: string;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null = null;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
