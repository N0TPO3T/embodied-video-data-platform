import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { CollectionTaskEntity } from "../database/entities/collection-task.entity.js";
import {
  LabelSetVersionEntity,
  type LabelSetItem,
} from "../database/entities/label-set-version.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { IdentityFailure } from "../identity/identity.policy.js";
import type { CreateLabelDto, UpdateLabelDto } from "./dto/label-set.dto.js";

const LABEL_SET_LOCK_KEY = 7_326_195_422;
const DEFAULT_LABELS: LabelSetItem[] = [
  // ---- 场景（scene）----
  { id: "SCENE-001", name: "家庭厨房", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-002", name: "家庭客厅", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-003", name: "家庭卧室", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-004", name: "卫生间", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-005", name: "阳台/晾晒区", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-006", name: "办公室/工位", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-007", name: "会议室", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-008", name: "仓库/库房", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-009", name: "车间/工坊", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-010", name: "超市/便利店", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-011", name: "餐厅/后厨", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-012", name: "户外街道", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-013", name: "公园/户外广场", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-014", name: "停车场/车库", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-015", name: "车内/驾驶舱", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-016", name: "电梯/楼梯间", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-017", name: "医院/诊所", type: "scene", associationCount: 0, enabled: true },
  { id: "SCENE-018", name: "学校/教室", type: "scene", associationCount: 0, enabled: true },
  // ---- 动作（action）----
  { id: "ACTION-001", name: "抓取", type: "action", associationCount: 0, enabled: true },
  { id: "ACTION-002", name: "放置", type: "action", associationCount: 0, enabled: true },
  { id: "ACTION-003", name: "折叠", type: "action", associationCount: 0, enabled: true },
  { id: "ACTION-004", name: "组装", type: "action", associationCount: 0, enabled: true },
  { id: "ACTION-005", name: "倾倒", type: "action", associationCount: 0, enabled: true },
  { id: "ACTION-006", name: "擦拭", type: "action", associationCount: 0, enabled: true },
  { id: "ACTION-007", name: "搬运", type: "action", associationCount: 0, enabled: true },
  { id: "ACTION-008", name: "拆解", type: "action", associationCount: 0, enabled: true },
  // ---- 对象（object）----
  { id: "OBJECT-001", name: "手持工具", type: "object", associationCount: 0, enabled: true },
  { id: "OBJECT-002", name: "餐具/厨具", type: "object", associationCount: 0, enabled: true },
  { id: "OBJECT-003", name: "纸张/纸箱", type: "object", associationCount: 0, enabled: true },
  { id: "OBJECT-004", name: "电子设备", type: "object", associationCount: 0, enabled: true },
  // ---- 质量问题（issue）----
  { id: "ISSUE-001", name: "镜头遮挡", type: "issue", associationCount: 0, enabled: true },
  { id: "ISSUE-002", name: "画面抖动", type: "issue", associationCount: 0, enabled: true },
  { id: "ISSUE-003", name: "光照不足", type: "issue", associationCount: 0, enabled: true },
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
      const latest = await repository
        .createQueryBuilder("labelSet")
        .select("MAX(labelSet.revision)", "max")
        .getRawOne<{ max: string | null }>();
      const nextRevision = Number(latest?.max ?? 0) + 1;
      return repository.save({
        id: `LSV-${randomUUID()}`,
        revision: nextRevision,
        version: `LABELS-REV-${nextRevision}`,
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

  /** 供 AI 质检 worker 等无管理员会话的服务读取当前标签体系 */
  async getActiveLabelSetForWorker(): Promise<LabelSetVersionEntity | null> {
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
      const nextId = input.nextId?.trim().toUpperCase() || existing.id;
      const duplicatedId = current.labels.some(
        (label) => label.id === nextId && label.id !== existing.id,
      );
      if (duplicatedId) {
        throw new IdentityFailure(
          "CONFLICT",
          `标签编号 ${nextId} 已存在`,
          409,
        );
      }
      const updatedLabel = {
        ...existing,
        id: nextId,
        name,
        enabled: input.enabled,
      };
      const labels = current.labels.map((label) =>
        label.id === existing.id ? updatedLabel : label,
      );
      if (nextId !== existing.id) {
        await manager
          .getRepository(CollectionTaskEntity)
          .update({ sceneLabelId: existing.id }, { sceneLabelId: nextId });
      }
      const latest = await repository
        .createQueryBuilder("labelSet")
        .select("MAX(labelSet.revision)", "max")
        .getRawOne<{ max: string | null }>();
      const nextRevision = Number(latest?.max ?? 0) + 1;
      current.active = false;
      await repository.save(current);
      const next = await repository.save({
        id: `LSV-${randomUUID()}`,
        revision: nextRevision,
        version: `LABELS-REV-${nextRevision}`,
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
        `更新标签 ${existing.id} / ${existing.name} 为 ${updatedLabel.id} / ${updatedLabel.name}`,
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

  async createLabel(
    actor: PublicUser,
    input: CreateLabelDto,
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
      const duplicate = current.labels.find(
        (label) => label.name === name && label.type === input.type,
      );
      if (duplicate) {
        throw new IdentityFailure(
          "VALIDATION",
          `同类型下已存在标签 ${name}`,
          409,
        );
      }
      const label: LabelSetItem = {
        id: nextLabelId(input.type, current.labels),
        name,
        type: input.type,
        associationCount: 0,
        enabled: input.enabled ?? true,
      };
      const labels = [...current.labels, label];
      const latest = await repository
        .createQueryBuilder("labelSet")
        .select("MAX(labelSet.revision)", "max")
        .getRawOne<{ max: string | null }>();
      const nextRevision = Number(latest?.max ?? 0) + 1;
      current.active = false;
      await repository.save(current);
      const next = await repository.save({
        id: `LSV-${randomUUID()}`,
        revision: nextRevision,
        version: `LABELS-REV-${nextRevision}`,
        labels,
        active: true,
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
      });
      await this.audit.record(
        manager,
        actor,
        "label_set_create",
        { id: label.id, name: label.name },
        `新增${typeName(label.type)}标签 ${label.name}`,
        { revision: current.revision },
        { revision: next.revision, label },
      );
      return next;
    });
  }

  async deleteLabel(
    actor: PublicUser,
    id: string,
  ): Promise<LabelSetVersionEntity> {
    this.requireAdmin(actor);
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
      const existing = current.labels.find((label) => label.id === id);
      if (!existing) {
        throw new IdentityFailure("NOT_FOUND", "标签不存在", 404);
      }
      const labels = current.labels.filter((label) => label.id !== id);
      const latest = await repository
        .createQueryBuilder("labelSet")
        .select("MAX(labelSet.revision)", "max")
        .getRawOne<{ max: string | null }>();
      const nextRevision = Number(latest?.max ?? 0) + 1;
      current.active = false;
      await repository.save(current);
      const next = await repository.save({
        id: `LSV-${randomUUID()}`,
        revision: nextRevision,
        version: `LABELS-REV-${nextRevision}`,
        labels,
        active: true,
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
      });
      await this.audit.record(
        manager,
        actor,
        "label_set_delete",
        { id: existing.id, name: existing.name },
        `删除${typeName(existing.type)}标签 ${existing.name}`,
        { revision: current.revision, label: existing },
        { revision: next.revision },
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

function nextLabelId(
  type: LabelSetItem["type"],
  labels: LabelSetItem[],
): string {
  const prefix = type.toUpperCase();
  const max = labels
    .filter((label) => label.type === type)
    .reduce((highest, label) => {
      const match = /^\w+-(\d+)$/u.exec(label.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

function typeName(type: LabelSetItem["type"]): string {
  const names: Record<LabelSetItem["type"], string> = {
    scene: "场景",
    action: "动作",
    object: "对象",
    issue: "质量问题",
  };
  return names[type];
}
