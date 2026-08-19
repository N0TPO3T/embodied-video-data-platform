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

export type ScarcityTier = {
  id: string;
  /** 存量下限（含） */
  minCount: number;
  /** 存量上限（含）；null 表示无上限 */
  maxCount: number | null;
  /** 奖励系数 0..1，存量越少系数越高 */
  coefficient: number;
  label: string;
};

export type ScarcityWeights = {
  /** 场景层级权重 */
  scene: number;
  /** 标准任务层级权重 */
  standardTask: number;
  /** 变体层级权重 */
  variant: number;
};

@Entity({ name: "scarcity_config" })
@Index("uq_scarcity_config_revision", ["revision"], { unique: true })
export class ScarcityConfigEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "integer" })
  revision!: number;

  @Column({ type: "varchar", length: 64 })
  version!: string;

  @Column({ type: "boolean", default: true })
  enabled = true;

  @Column({ type: "jsonb" })
  tiers!: ScarcityTier[];

  @Column({ type: "jsonb" })
  weights!: ScarcityWeights;

  @Column({ type: "text" })
  description!: string;

  @Column({ name: "created_by_account_id", type: "varchar", length: 64 })
  createdByAccountId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_account_id" })
  createdBy?: UserEntity;

  @Column({ name: "created_by_name", type: "varchar", length: 120 })
  createdByName!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
