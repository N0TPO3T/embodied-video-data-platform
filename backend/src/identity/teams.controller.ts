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
import { CreateTeamDto, UpdateTeamDto } from "./dto/team.dto.js";
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
  @UseGuards(AllowedOriginGuard)
  async create(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateTeamDto,
  ) {
    return { team: await this.teams.create(actor, input) };
  }

  @Patch(":id")
  @UseGuards(AllowedOriginGuard)
  async update(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: UpdateTeamDto,
  ) {
    return { team: await this.teams.update(actor, id, input) };
  }
}
