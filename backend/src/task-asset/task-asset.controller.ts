import { Controller, Get, Query, Res, UseFilters, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { OperationsFailureFilter } from "../operations/operations-failure.filter.js";
import { TaskAssetService } from "./task-asset.service.js";

@Controller("operations/task-assets")
@UseGuards(SessionGuard)
@UseFilters(OperationsFailureFilter)
export class TaskAssetController {
  constructor(private readonly assets: TaskAssetService) {}

  @Get()
  list(@CurrentUser() actor: PublicUser, @Query() query: Record<string, unknown>) { return this.assets.list(actor, query); }

  @Get("facets")
  facets(@CurrentUser() actor: PublicUser, @Query() query: Record<string, unknown>) { return this.assets.facets(actor, query); }

  @Get("scene-summary")
  sceneSummary(@CurrentUser() actor: PublicUser, @Query() query: Record<string, unknown>) { return this.assets.sceneSummary(actor, query); }

  @Get("export.csv")
  async exportCsv(@CurrentUser() actor: PublicUser, @Query() query: Record<string, unknown>, @Res() response: Response) {
    const csv = await this.assets.exportCsv(actor, query);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="task-assets.csv"');
    response.setHeader("Cache-Control", "no-store");
    response.send(csv);
  }
}
