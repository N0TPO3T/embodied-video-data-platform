import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  type Relation,
} from "typeorm";

import { DeliveryPackageItemEntity } from "./delivery-package-item.entity.js";
import { UserEntity } from "./user.entity.js";

export type DeliveryPackageStatus = "ready";

@Entity({ name: "delivery_packages" })
@Index("idx_delivery_packages_created_at", ["createdAt"])
export class DeliveryPackageEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "varchar", length: 16, default: "ready" })
  status: DeliveryPackageStatus = "ready";

  @Column({ name: "asset_count", type: "integer" })
  assetCount!: number;

  @Column({ name: "total_size_bytes", type: "bigint" })
  totalSizeBytes!: string;

  @Column({ name: "created_by_account_id", type: "varchar", length: 64 })
  createdByAccountId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_account_id" })
  createdBy?: Relation<UserEntity>;

  @Column({ name: "created_by_name", type: "varchar", length: 120 })
  createdByName!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @OneToMany(() => DeliveryPackageItemEntity, (item) => item.package)
  items?: Relation<DeliveryPackageItemEntity[]>;
}
