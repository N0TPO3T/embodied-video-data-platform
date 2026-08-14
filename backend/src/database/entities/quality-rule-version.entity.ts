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

@Entity({ name: "quality_rule_versions" })
@Index("uq_quality_rule_versions_revision", ["revision"], { unique: true })
export class QualityRuleVersionEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "integer" })
  revision!: number;

  @Column({ type: "varchar", length: 64 })
  version!: string;

  @Column({ name: "pass_threshold", type: "integer" })
  passThreshold!: number;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "boolean", default: false })
  active = false;

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
