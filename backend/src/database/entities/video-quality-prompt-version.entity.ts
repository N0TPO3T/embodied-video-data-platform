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

@Entity({ name: "video_quality_prompt_versions" })
@Index("uq_video_quality_prompt_revision", ["revision"], { unique: true })
export class VideoQualityPromptVersionEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "integer" })
  revision!: number;

  @Column({ name: "system_prompt", type: "text" })
  systemPrompt!: string;

  @Column({ name: "content_sha256", type: "char", length: 64 })
  contentSha256!: string;

  @Column({ name: "prompt_version", type: "varchar", length: 64 })
  promptVersion!: string;

  @Column({ name: "rule_version", type: "varchar", length: 64 })
  ruleVersion!: string;

  @Column({ name: "output_schema", type: "varchar", length: 64 })
  outputSchema!: string;

  @Column({ name: "initial_model", type: "varchar", length: 120 })
  initialModel!: string;

  @Column({ name: "review_model", type: "varchar", length: 120 })
  reviewModel!: string;

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
