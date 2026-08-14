import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";
import {
  AssignTeamLeaderDto,
  CreateTeamDto,
  UpdateTeamDto,
} from "./dto/team.dto.js";
import { IdentityFailureFilter } from "./identity-failure.filter.js";
import { TeamsService } from "./teams.service.js";

@Controller("teams")
@UseGuards(SessionGuard)
@UseFilters(IdentityFailureFilter)
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  async list(@CurrentUser() actor: PublicUser) {
    return { teams: await this.teams.list(actor) };
  }

  @Post()
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async create(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateTeamDto,
  ) {
    return { team: await this.teams.create(actor, input) };
  }

  @Patch(":id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async update(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: UpdateTeamDto,
  ) {
    return { team: await this.teams.update(actor, id, input) };
  }

  @Patch(":id/leader")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async assignLeader(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: AssignTeamLeaderDto,
  ) {
    return { accounts: await this.teams.assignLeader(actor, id, input) };
  }
}
