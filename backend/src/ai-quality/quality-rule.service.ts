import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { QualityRuleVersionEntity } from "../database/entities/quality-rule-version.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { IdentityFailure } from "../identity/identity.policy.js";
import type { CreateQualityRuleDto } from "./dto/quality-rule.dto.js";

const QUALITY_RULE_LOCK_KEY = 7_326_195_421;
const DEFAULT_RULE = {
  version: "RULE-2026-08",
  passThreshold: 60,
  description: "八月具身视频质量准入规则",
};

export type PublicQualityRule = {
  id: string;
  revision: number;
  version: string;
  passThreshold: number;
  description: string;
  active: boolean;
  createdByAccountId: string;
  createdByName: string;
  createdAt: number;
};

function normalizeRuleInput(input: CreateQualityRuleDto): CreateQualityRuleDto {
  const version = input.version.trim();
  const description = input.description.trim();
  if (!version) {
    throw new IdentityFailure("VALIDATION", "请填写版本名称", 400);
  }
  if (!description) {
    throw new IdentityFailure("VALIDATION", "请填写规则说明", 400);
  }
  return {
    version,
    description,
    passThreshold: input.passThreshold,
  };
}

export function publicQualityRule(
  rule: QualityRuleVersionEntity,
): PublicQualityRule {
  return {
    id: rule.id,
    revision: rule.revision,
    version: rule.version,
    passThreshold: rule.passThreshold,
    description: rule.description,
    active: rule.active,
    createdByAccountId: rule.createdByAccountId,
    createdByName: rule.createdByName,
    createdAt: rule.createdAt.getTime(),
  };
}

@Injectable()
export class QualityRuleService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(QualityRuleVersionEntity)
    private readonly rules: Repository<QualityRuleVersionEntity>,
    private readonly audit: AuditService,
  ) {}

  async ensureDefault(): Promise<QualityRuleVersionEntity> {
    const current = await this.rules.findOneBy({ active: true });
    if (current) return current;

    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        QUALITY_RULE_LOCK_KEY,
      ]);
      const repository = manager.getRepository(QualityRuleVersionEntity);
      const active = await repository.findOneBy({ active: true });
      if (active) return active;
      const creator = await manager.getRepository(UserEntity).findOne({
        where: { role: "admin", status: "active" },
        order: { createdAt: "ASC" },
      });
      if (!creator) {
        throw new Error("初始化质量规则前必须存在启用的管理员账号");
      }
      return repository.save({
        id: `QRV-${randomUUID()}`,
        revision: 1,
        ...DEFAULT_RULE,
        active: true,
        createdByAccountId: creator.id,
        createdByName: "系统初始化",
      });
    });
  }

  async getActive(actor: PublicUser): Promise<QualityRuleVersionEntity> {
    this.requireAdmin(actor);
    return this.ensureDefault();
  }

  async create(
    actor: PublicUser,
    input: CreateQualityRuleDto,
  ): Promise<QualityRuleVersionEntity> {
    this.requireAdmin(actor);
    const normalized = normalizeRuleInput(input);
    await this.ensureDefault();
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        QUALITY_RULE_LOCK_KEY,
      ]);
      const repository = manager.getRepository(QualityRuleVersionEntity);
      const existing = await repository.findOneBy({
        version: normalized.version,
      });
      if (existing) {
        throw new IdentityFailure(
          "CONFLICT",
          "质量规则版本名称已存在",
          409,
        );
      }
      const current = await repository.findOne({
        where: { active: true },
        lock: { mode: "pessimistic_write" },
      });
      if (!current) throw new Error("当前质量规则不存在");
      current.active = false;
      await repository.save(current);
      const next = await repository.save({
        id: `QRV-${randomUUID()}`,
        revision: current.revision + 1,
        ...normalized,
        active: true,
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
      });
      await this.audit.record(
        manager,
        actor,
        "quality_rule_publish",
        { id: next.id, name: next.version },
        `发布质量规则 ${next.version}，通过阈值 ${next.passThreshold} 分`,
        {
          version: current.version,
          passThreshold: current.passThreshold,
        },
        {
          version: next.version,
          passThreshold: next.passThreshold,
        },
      );
      return next;
    });
  }

  private requireAdmin(actor: PublicUser): void {
    if (actor.status !== "active" || actor.role !== "admin") {
      throw new IdentityFailure("FORBIDDEN", "仅管理员可管理质量规则", 403);
    }
  }
}
