import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

@Entity({ name: "audit_logs" })
@Index("idx_audit_logs_created_at", ["createdAt"])
@Index("idx_audit_logs_target", ["targetAccountId"])
export class AuditLogEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "actor_account_id", type: "varchar", length: 64 })
  actorAccountId!: string;

  @Column({ name: "actor_name", type: "varchar", length: 120 })
  actorName!: string;

  @Column({ type: "varchar", length: 64 })
  action!: string;

  @Column({ name: "target_account_id", type: "varchar", length: 64 })
  targetAccountId!: string;

  @Column({ name: "target_name", type: "varchar", length: 120 })
  targetName!: string;

  @Column({ type: "text" })
  summary!: string;

  @Column({ name: "before_value", type: "jsonb", nullable: true })
  beforeValue: Record<string, unknown> | null = null;

  @Column({ name: "after_value", type: "jsonb", nullable: true })
  afterValue: Record<string, unknown> | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
