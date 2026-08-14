import {
  Controller,
  Get,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { IdentityFailureFilter } from "../identity/identity-failure.filter.js";
import { IdentityFailure } from "../identity/identity.policy.js";
import { AuditService } from "./audit.service.js";
import { ListAuditLogsQueryDto } from "./dto/audit-log-query.dto.js";

@Controller("audit-logs")
@UseGuards(SessionGuard)
@UseFilters(IdentityFailureFilter)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get("export.csv")
  async exportCsv(
    @CurrentUser() actor: PublicUser,
    @Query() query: ListAuditLogsQueryDto,
    @Res() response: Response,
  ) {
    if (actor.role !== "admin") {
      throw new IdentityFailure(
        "FORBIDDEN",
        "仅管理员可导出审计日志",
        403,
      );
    }
    const csv = await this.audit.exportCsv(query);
    response
      .setHeader("content-type", "text/csv; charset=utf-8")
      .setHeader(
        "content-disposition",
        'attachment; filename="audit-logs-export.csv"',
      )
      .send(csv);
  }

  @Get()
  async list(
    @CurrentUser() actor: PublicUser,
    @Query() query: ListAuditLogsQueryDto,
  ) {
    if (actor.role !== "admin") {
      throw new IdentityFailure(
        "FORBIDDEN",
        "仅管理员可查看审计日志",
        403,
      );
    }
    return await this.audit.list(query);
  }
}
