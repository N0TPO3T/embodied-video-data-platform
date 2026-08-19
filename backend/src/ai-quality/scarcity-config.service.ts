import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import {
  ScarcityConfigEntity,
  type ScarcityTier,
  type ScarcityWeights,
} from "../database/entities/scarcity-config.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { IdentityFailure } from "../identity/identity.policy.js";
import type { PublishScarcityConfigDto } from "./dto/scarcity-config.dto.js";

const SCARCITY_CONFIG_LOCK_KEY = 8_410_233_917;

export const DEFAULT_SCARCITY_TIERS: ScarcityTier[] = [
  { id: randomUUID(), minCount: 0, maxCount: 5, coefficient: 1.0, label: "稀缺" },
  { id: randomUUID(), minCount: 6, maxCount: 20, coefficient: 0.9, label: "较少" },
  { id: randomUUID(), minCount: 21, maxCount: 50, coefficient: 0.75, label: "中等" },
  { id: randomUUID(), minCount: 51, maxCount: 100, coefficient: 0.6, label: "较多" },
  { id: randomUUID(), minCount: 101, maxCount: null, coefficient: 0.5, label: "饱和" },
];

export const DEFAULT_SCARCITY_WEIGHTS: ScarcityWeights = {
  scene: 0.2,
  standardTask: 0.5,
  variant: 0.3,
};

export const DEFAULT_SCARCITY_DESCRIPTION =
  "按场景/标准任务/变体的有效存量分档计酬：存量越少系数越高（稀缺奖励）。" +
  "C_inventory = 0.2×C_scene + 0.5×C_standard_task + 0.3×C_variant";

export type PublicScarcityConfig = {
  id: string;
  revision: number;
  version: string;
  enabled: boolean;
  tiers: ScarcityTier[];
  weights: ScarcityWeights;
  description: string;
  createdByAccountId: string;
  createdByName: string;
  createdAt: number;
};

export function publicScarcityConfig(
  config: ScarcityConfigEntity,
): PublicScarcityConfig {
  return {
    id: config.id,
    revision: config.revision,
    version: config.version,
    enabled: config.enabled,
    tiers: config.tiers,
    weights: config.weights,
    description: config.description,
    createdByAccountId: config.createdByAccountId,
    createdByName: config.createdByName,
    createdAt: config.createdAt.getTime(),
  };
}

@Injectable()
export class ScarcityConfigService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ScarcityConfigEntity)
    private readonly configs: Repository<ScarcityConfigEntity>,
    private readonly audit: AuditService,
  ) {}

  async ensureDefault(): Promise<ScarcityConfigEntity> {
    const current = await this.configs.findOneBy({ enabled: true });
    if (current) return current;

    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        SCARCITY_CONFIG_LOCK_KEY,
      ]);
      const repository = manager.getRepository(ScarcityConfigEntity);
      const active = await repository.findOneBy({ enabled: true });
      if (active) return active;
      const creator = await manager.getRepository(UserEntity).findOne({
        where: { role: "admin", status: "active" },
        order: { createdAt: "ASC" },
      });
      if (!creator) {
        throw new Error("初始化稀缺奖励配置前必须存在启用的管理员账号");
      }
      const latest = await repository
        .createQueryBuilder("scarcityConfig")
        .select("MAX(scarcityConfig.revision)", "max")
        .getRawOne<{ max: string | null }>();
      const nextRevision = Number(latest?.max ?? 0) + 1;
      return repository.save({
        id: `SC-${randomUUID()}`,
        revision: nextRevision,
        version: `SCARCITY-REV-${nextRevision}`,
        enabled: true,
        tiers: DEFAULT_SCARCITY_TIERS,
        weights: DEFAULT_SCARCITY_WEIGHTS,
        description: DEFAULT_SCARCITY_DESCRIPTION,
        createdByAccountId: creator.id,
        createdByName: "系统初始化",
      });
    });
  }

  async getActive(): Promise<ScarcityConfigEntity> {
    return this.ensureDefault();
  }

  async publish(
    actor: PublicUser,
    input: PublishScarcityConfigDto,
  ): Promise<ScarcityConfigEntity> {
    this.requireAdmin(actor);
    this.validateTiers(input.tiers);
    await this.ensureDefault();
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        SCARCITY_CONFIG_LOCK_KEY,
      ]);
      const repository = manager.getRepository(ScarcityConfigEntity);
      const current = await repository.findOne({
        where: { enabled: true },
        lock: { mode: "pessimistic_write" },
      });
      if (!current) throw new Error("当前稀缺奖励配置不存在");
      current.enabled = false;
      await repository.save(current);
      const next = await repository.save({
        id: `SC-${randomUUID()}`,
        revision: current.revision + 1,
        version: `SCARCITY-REV-${current.revision + 1}`,
        enabled: true,
        tiers: input.tiers,
        weights: input.weights,
        description: input.description.trim(),
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
      });
      await this.audit.record(
        manager,
        actor,
        "scarcity_config_publish",
        { id: next.id, name: next.version },
        `发布稀缺奖励配置 V${next.revision}`,
        { revision: current.revision, tiers: current.tiers },
        { revision: next.revision, tiers: next.tiers },
      );
      return next;
    });
  }

  private validateTiers(tiers: ScarcityTier[]): void {
    const sorted = [...tiers].sort((a, b) => a.minCount - b.minCount);
    for (let index = 0; index < sorted.length; index += 1) {
      const tier = sorted[index]!;
      if (tier.maxCount !== null && tier.maxCount < tier.minCount) {
        throw new IdentityFailure(
          "VALIDATION",
          `档位 ${tier.label} 的上限不能小于下限`,
          400,
        );
      }
      if (index > 0) {
        const previous = sorted[index - 1]!;
        const previousUpper =
          previous.maxCount === null ? Number.POSITIVE_INFINITY : previous.maxCount;
        if (tier.minCount <= previousUpper + 1) {
          throw new IdentityFailure(
            "VALIDATION",
            `档位 ${previous.label} 与 ${tier.label} 区间重叠或未覆盖`,
            400,
          );
        }
      }
    }
    const last = sorted[sorted.length - 1]!;
    if (last.maxCount !== null) {
      throw new IdentityFailure(
        "VALIDATION",
        "最后一个档位必须为无上限（maxCount = null）",
        400,
      );
    }
  }

  private requireAdmin(actor: PublicUser): void {
    if (actor.status !== "active" || actor.role !== "admin") {
      throw new IdentityFailure("FORBIDDEN", "仅管理员可管理稀缺奖励配置", 403);
    }
  }
}
