import {
  Controller,
  Get,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { IdentityFailureFilter } from "../identity/identity-failure.filter.js";
import { IdentityFailure } from "../identity/identity.policy.js";
import { AuditService } from "./audit.service.js";

@Controller("audit-logs")
@UseGuards(SessionGuard)
@UseFilters(IdentityFailureFilter)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(@CurrentUser() actor: PublicUser) {
    if (actor.role !== "admin") {
      throw new IdentityFailure(
        "FORBIDDEN",
        "仅管理员可查看审计日志",
        403,
      );
    }
    const logs = await this.audit.list();
    return {
      logs: logs.map((log) => ({
        id: log.id,
        actorAccountId: log.actorAccountId,
        actorName: log.actorName,
        action: log.action,
        targetAccountId: log.targetAccountId,
        targetName: log.targetName,
        summary: log.summary,
        createdAt: log.createdAt.getTime(),
      })),
    };
  }
}
