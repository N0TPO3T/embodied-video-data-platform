import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

export type TeamStatus = "active" | "disabled";

@Entity({ name: "teams" })
export class TeamEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 16, default: "active" })
  status: TeamStatus = "active";

  @Column({
    name: "unit_price_per_minute",
    type: "numeric",
    precision: 12,
    scale: 4,
    default: 0,
  })
  unitPricePerMinute = "0";

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
