import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EntityManager } from "typeorm";
import { Brackets, Repository } from "typeorm";

import type { PublicUser } from "../auth/auth.types.js";
import { AuditLogEntity } from "../database/entities/audit-log.entity.js";
import type { ListAuditLogsQueryDto } from "./dto/audit-log-query.dto.js";

export type AuditTarget = {
  id: string;
  name: string;
};

export type PublicAuditLog = {
  id: string;
  actorAccountId: string;
  actorName: string;
  action: string;
  targetAccountId: string;
  targetName: string;
  summary: string;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown> | null;
  createdAt: number;
};

export type AuditLogListResult = {
  logs: PublicAuditLog[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/u.test(raw)) return raw;
  return `"${raw.replaceAll('"', '""')}"`;
}

function auditBoundaryDate(value: string, boundary: "start" | "end"): Date {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const time =
      boundary === "start" ? "00:00:00.000" : "23:59:59.999";
    return new Date(`${value}T${time}+08:00`);
  }
  return new Date(value);
}

export function publicAuditLog(log: AuditLogEntity): PublicAuditLog {
  return {
    id: log.id,
    actorAccountId: log.actorAccountId,
    actorName: log.actorName,
    action: log.action,
    targetAccountId: log.targetAccountId,
    targetName: log.targetName,
    summary: log.summary,
    beforeValue: log.beforeValue,
    afterValue: log.afterValue,
    createdAt: log.createdAt.getTime(),
  };
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly logs: Repository<AuditLogEntity>,
  ) {}

  async record(
    manager: EntityManager,
    actor: PublicUser,
    action: string,
    target: AuditTarget,
    summary: string,
    beforeValue: Record<string, unknown> | null = null,
    afterValue: Record<string, unknown> | null = null,
  ): Promise<void> {
    await manager.getRepository(AuditLogEntity).save({
      id: `AUD-${randomUUID()}`,
      actorAccountId: actor.id,
      actorName: actor.displayName,
      action,
      targetAccountId: target.id,
      targetName: target.name,
      summary,
      beforeValue,
      afterValue,
    });
  }

  async list(
    input: ListAuditLogsQueryDto = {},
  ): Promise<AuditLogListResult> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 100;
    const query = this.createListQuery(input);

    const total = await query.getCount();
    const logs = await query
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      logs: logs.map(publicAuditLog),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async exportCsv(input: ListAuditLogsQueryDto = {}): Promise<string> {
    const logs = await this.createListQuery(input).getMany();
    const rows = [
      [
        "audit_id",
        "created_at",
        "actor_account_id",
        "actor_name",
        "action",
        "target_id",
        "target_name",
        "summary",
        "before_value",
        "after_value",
      ],
      ...logs.map((log) => [
        log.id,
        log.createdAt.toISOString(),
        log.actorAccountId,
        log.actorName,
        log.action,
        log.targetAccountId,
        log.targetName,
        log.summary,
        log.beforeValue ? JSON.stringify(log.beforeValue) : "",
        log.afterValue ? JSON.stringify(log.afterValue) : "",
      ]),
    ];
    return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  }

  private createListQuery(input: ListAuditLogsQueryDto = {}) {
    const query = this.logs
      .createQueryBuilder("audit")
      .orderBy("audit.createdAt", "DESC")
      .addOrderBy("audit.id", "DESC");

    const search = input.q?.trim();
    if (search) {
      const term = `%${escapeLike(search).toLowerCase()}%`;
      query.andWhere(
        new Brackets((builder) => {
          builder
            .where("LOWER(audit.id) LIKE :search ESCAPE '\\'", {
              search: term,
            })
            .orWhere("LOWER(audit.action) LIKE :search ESCAPE '\\'", {
              search: term,
            })
            .orWhere(
              "LOWER(audit.targetAccountId) LIKE :search ESCAPE '\\'",
              { search: term },
            )
            .orWhere("LOWER(audit.targetName) LIKE :search ESCAPE '\\'", {
              search: term,
            })
            .orWhere("LOWER(audit.summary) LIKE :search ESCAPE '\\'", {
              search: term,
            });
        }),
      );
    }

    const actor = input.actor?.trim();
    if (actor) {
      const term = `%${escapeLike(actor).toLowerCase()}%`;
      query.andWhere(
        new Brackets((builder) => {
          builder
            .where("LOWER(audit.actorAccountId) LIKE :actor ESCAPE '\\'", {
              actor: term,
            })
            .orWhere("LOWER(audit.actorName) LIKE :actor ESCAPE '\\'", {
              actor: term,
            });
        }),
      );
    }

    const action = input.action?.trim();
    if (action && action !== "all") {
      query.andWhere("audit.action = :action", { action });
    }

    if (input.from) {
      query.andWhere("audit.createdAt >= :from", {
        from: auditBoundaryDate(input.from, "start"),
      });
    }
    if (input.to) {
      query.andWhere("audit.createdAt <= :to", {
        to: auditBoundaryDate(input.to, "end"),
      });
    }

    return query;
  }
}
