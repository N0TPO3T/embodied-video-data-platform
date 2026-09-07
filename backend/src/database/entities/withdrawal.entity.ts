import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type WithdrawalStatus = "pending" | "processing" | "paid" | "rejected" | "failed";

@Entity({ name: "withdrawal_batches" })
export class WithdrawalBatchEntity {
  @PrimaryColumn({ type: "varchar", length: 64 }) id!: string;
  @Column({ name: "created_by", type: "varchar", length: 64 }) createdBy!: string;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}

@Entity({ name: "withdrawal_requests" })
@Index("uq_withdrawal_owner_key", ["ownerId", "idempotencyKey"], { unique: true })
@Index("idx_withdrawal_status_created", ["status", "createdAt"])
export class WithdrawalRequestEntity {
  @PrimaryColumn({ type: "varchar", length: 64 }) id!: string;
  @Column({ name: "owner_id", type: "varchar", length: 64 }) ownerId!: string;
  @Column({ name: "idempotency_key", type: "varchar", length: 64 }) idempotencyKey!: string;
  @Column({ name: "payload_hash", type: "varchar", length: 64 }) payloadHash!: string;
  @Column({ type: "numeric", precision: 14, scale: 2 }) amount!: string;
  @Column({ type: "varchar", length: 16 }) status!: WithdrawalStatus;
  @Column({ type: "varchar", length: 16 }) method!: "alipay" | "bank";
  @Column({ name: "recipient_encrypted", type: "text", select: false }) recipientEncrypted!: string;
  @Column({ name: "account_masked", type: "varchar", length: 16 }) accountMasked!: string;
  @Column({ name: "name_masked", type: "varchar", length: 16 }) nameMasked!: string;
  @Column({ name: "batch_id", type: "varchar", length: 64, nullable: true }) batchId: string | null = null;
  @Column({ type: "varchar", length: 500, nullable: true }) reason: string | null = null;
  @Column({ name: "transfer_reference", type: "varchar", length: 120, nullable: true }) transferReference: string | null = null;
  @Column({ name: "paid_at", type: "timestamptz", nullable: true }) paidAt: Date | null = null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
