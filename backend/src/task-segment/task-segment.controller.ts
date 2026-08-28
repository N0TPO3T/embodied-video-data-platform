import { Controller, Get, Param, Post, Query, UseFilters, UseGuards } from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { OperationsFailureFilter } from "../operations/operations-failure.filter.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";
import { TaskSegmentQueryDto } from "./dto/task-segment-query.dto.js";
import { TaskSegmentService } from "./task-segment.service.js";

@Controller("operations")
@UseGuards(SessionGuard)
@UseFilters(OperationsFailureFilter)
export class TaskSegmentController {
  constructor(private readonly taskSegments: TaskSegmentService) {}

  @Post("annotation-runs/:runId/task-segments/generate")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  generate(
    @CurrentUser() actor: PublicUser,
    @Param("runId") runId: string,
  ) {
    return this.taskSegments.generate(actor, runId);
  }

  @Get("task-segment-assets")
  list(
    @CurrentUser() actor: PublicUser,
    @Query() query: TaskSegmentQueryDto,
  ) {
    return this.taskSegments.list(actor, query);
  }

  @Get("task-segment-assets/:assetId")
  get(
    @CurrentUser() actor: PublicUser,
    @Param("assetId") assetId: string,
  ) {
    return this.taskSegments.get(actor, assetId);
  }

  @Get("task-segment-assets/:assetId/preview")
  preview(
    @CurrentUser() actor: PublicUser,
    @Param("assetId") assetId: string,
  ) {
    return this.taskSegments.preview(actor, assetId);
  }

  @Post("task-segment-assets/:assetId/retry")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  retry(
    @CurrentUser() actor: PublicUser,
    @Param("assetId") assetId: string,
  ) {
    return this.taskSegments.retry(actor, assetId);
  }
}
