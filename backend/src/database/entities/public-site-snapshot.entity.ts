import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { UserEntity } from "./user.entity.js";

export type PublicSiteScene = {
  name: string;
  description: string;
  videoCount: number;
  share: number;
};

export type PublicSiteTrendPoint = {
  label: string;
  value: number;
};

@Entity({ name: "public_site_snapshots" })
@Index("idx_public_site_snapshots_date", ["snapshotDate"])
@Index("idx_public_site_snapshots_created_at", ["createdAt"])
export class PublicSiteSnapshotEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "integer" })
  revision!: number;

  @Column({ name: "snapshot_date", type: "date" })
  snapshotDate!: string;

  @Column({ type: "boolean", default: true })
  active = true;

  @Column({ name: "deliverable_video_count", type: "integer" })
  deliverableVideoCount!: number;

  @Column({ name: "effective_duration_seconds", type: "bigint" })
  effectiveDurationSeconds!: string;

  @Column({ name: "scene_count", type: "integer" })
  sceneCount!: number;

  @Column({
    name: "quality_pass_rate",
    type: "numeric",
    precision: 6,
    scale: 2,
  })
  qualityPassRate!: string;

  @Column({ name: "primary_scene_name", type: "varchar", length: 80 })
  primarySceneName!: string;

  @Column({ name: "primary_scene_description", type: "varchar", length: 200 })
  primarySceneDescription!: string;

  @Column({ name: "cta_copy", type: "varchar", length: 160 })
  ctaCopy!: string;

  @Column({ name: "scene_breakdown", type: "jsonb" })
  sceneBreakdown!: PublicSiteScene[];

  @Column({ type: "jsonb" })
  trend!: PublicSiteTrendPoint[];

  @Column({
    name: "generated_by_account_id",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  generatedByAccountId: string | null = null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "generated_by_account_id" })
  generatedBy?: UserEntity | null;

  @Column({ name: "generated_by_name", type: "varchar", length: 120 })
  generatedByName!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
