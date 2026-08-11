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

@Entity({ name: "sessions" })
@Index("idx_sessions_account_id", ["accountId"])
@Index("idx_sessions_expires_at", ["expiresAt"])
export class SessionEntity {
  @PrimaryColumn({ name: "token_hash", type: "char", length: 64 })
  tokenHash!: string;

  @Column({ name: "account_id", type: "varchar", length: 64 })
  accountId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "account_id" })
  account?: UserEntity;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;
}
