import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import {
  LabelSetVersionEntity,
  type LabelSetItem,
} from "../database/entities/label-set-version.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { IdentityFailure } from "../identity/identity.policy.js";
import type { UpdateLabelDto } from "./dto/label-set.dto.js";

const LABEL_SET_LOCK_KEY = 7_326_195_422;
const DEFAULT_LABELS: LabelSetItem[] = [
  {
    id: "SCENE-001",
    name: "家庭厨房",
    type: "scene",
    associationCount: 186,
    enabled: true,
  },
  {
    id: "ACTION-014",
    name: "组装",
    type: "action",
    associationCount: 94,
    enabled: true,
  },
  {
    id: "OBJECT-032",
    name: "手持工具",
    type: "object",
    associationCount: 128,
    enabled: true,
  },
  {
    id: "ISSUE-006",
    name: "镜头遮挡",
    type: "issue",
    associationCount: 37,
    enabled: true,
  },
];

export type PublicLabelSet = {
  id: string;
  revision: number;
  version: string;
  labels: LabelSetItem[];
  active: boolean;
  createdByAccountId: string;
  createdByName: string;
  createdAt: number;
};

export function publicLabelSet(
  labelSet: LabelSetVersionEntity,
): PublicLabelSet {
  return {
    id: labelSet.id,
    revision: labelSet.revision,
    version: labelSet.version,
    labels: labelSet.labels,
    active: labelSet.active,
    createdByAccountId: labelSet.createdByAccountId,
    createdByName: labelSet.createdByName,
    createdAt: labelSet.createdAt.getTime(),
  };
}

@Injectable()
export class LabelSetService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(LabelSetVersionEntity)
    private readonly labelSets: Repository<LabelSetVersionEntity>,
    private readonly audit: AuditService,
  ) {}

  async ensureDefault(): Promise<LabelSetVersionEntity> {
    const current = await this.labelSets.findOneBy({ active: true });
    if (current) return current;

    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        LABEL_SET_LOCK_KEY,
      ]);
      const repository = manager.getRepository(LabelSetVersionEntity);
      const active = await repository.findOneBy({ active: true });
      if (active) return active;
      const creator = await manager.getRepository(UserEntity).findOne({
        where: { role: "admin", status: "active" },
        order: { createdAt: "ASC" },
      });
      if (!creator) {
        throw new Error("初始化标签体系前必须存在启用的管理员账号");
      }
      return repository.save({
        id: `LSV-${randomUUID()}`,
        revision: 1,
        version: "LABELS-2026-08",
        labels: DEFAULT_LABELS,
        active: true,
        createdByAccountId: creator.id,
        createdByName: "系统初始化",
      });
    });
  }

  async getActive(actor: PublicUser): Promise<LabelSetVersionEntity> {
    this.requireAdmin(actor);
    return this.ensureDefault();
  }

  async updateLabel(
    actor: PublicUser,
    input: UpdateLabelDto,
  ): Promise<LabelSetVersionEntity> {
    this.requireAdmin(actor);
    const name = input.name.trim();
    if (!name) {
      throw new IdentityFailure("VALIDATION", "请填写标签名称", 400);
    }
    await this.ensureDefault();
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        LABEL_SET_LOCK_KEY,
      ]);
      const repository = manager.getRepository(LabelSetVersionEntity);
      const current = await repository.findOne({
        where: { active: true },
        lock: { mode: "pessimistic_write" },
      });
      if (!current) throw new Error("当前标签体系不存在");
      const existing = current.labels.find((label) => label.id === input.id);
      if (!existing) {
        throw new IdentityFailure("NOT_FOUND", "标签不存在", 404);
      }
      const updatedLabel = {
        ...existing,
        name,
        enabled: input.enabled,
      };
      const labels = current.labels.map((label) =>
        label.id === updatedLabel.id ? updatedLabel : label,
      );
      current.active = false;
      await repository.save(current);
      const next = await repository.save({
        id: `LSV-${randomUUID()}`,
        revision: current.revision + 1,
        version: `LABELS-REV-${current.revision + 1}`,
        labels,
        active: true,
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
      });
      await this.audit.record(
        manager,
        actor,
        "label_set_update",
        { id: updatedLabel.id, name: updatedLabel.name },
        `更新标签 ${existing.name} 为 ${updatedLabel.name}`,
        {
          revision: current.revision,
          label: existing,
        },
        {
          revision: next.revision,
          label: updatedLabel,
        },
      );
      return next;
    });
  }

  private requireAdmin(actor: PublicUser): void {
    if (actor.status !== "active" || actor.role !== "admin") {
      throw new IdentityFailure("FORBIDDEN", "仅管理员可管理标签体系", 403);
    }
  }
}
