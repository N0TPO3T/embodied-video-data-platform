import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

export type OutboxStatus = "pending" | "published";

@Entity({ name: "job_outbox" })
@Index("idx_job_outbox_ready", ["status", "availableAt", "createdAt"])
@Index("uq_job_outbox_event_aggregate", ["eventType", "aggregateId"], {
  unique: true,
})
export class JobOutboxEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "aggregate_type", type: "varchar", length: 32 })
  aggregateType!: string;

  @Column({ name: "aggregate_id", type: "varchar", length: 64 })
  aggregateId!: string;

  @Column({ name: "event_type", type: "varchar", length: 64 })
  eventType!: string;

  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: "varchar", length: 16, default: "pending" })
  status: OutboxStatus = "pending";

  @Column({ type: "integer", default: 0 })
  attempts = 0;

  @Column({ name: "available_at", type: "timestamptz" })
  availableAt!: Date;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt: Date | null = null;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
