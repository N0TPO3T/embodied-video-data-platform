import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EntityManager } from "typeorm";
import { Repository } from "typeorm";

import type { PublicUser } from "../auth/auth.types.js";
import { AuditLogEntity } from "../database/entities/audit-log.entity.js";

export type AuditTarget = {
  id: string;
  name: string;
};

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

  async list(limit = 100): Promise<AuditLogEntity[]> {
    return this.logs.find({
      order: { createdAt: "DESC" },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }
}
