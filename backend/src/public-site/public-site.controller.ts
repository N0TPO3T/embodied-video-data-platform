import {
  Body,
  Controller,
  Get,
  Put,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { IdentityFailureFilter } from "../identity/identity-failure.filter.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";
import { UpdatePublicSiteConfigDto } from "./dto/public-site-config.dto.js";
import { PublicSiteService } from "./public-site.service.js";

@Controller("public-site")
@UseFilters(IdentityFailureFilter)
export class PublicSiteController {
  constructor(private readonly publicSite: PublicSiteService) {}

  @Get("snapshot")
  async snapshot(@Res({ passthrough: true }) response: Response) {
    response.setHeader("Cache-Control", "no-store");
    return { snapshot: await this.publicSite.getSnapshot() };
  }

  @Put("snapshot")
  @UseGuards(SessionGuard, AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async publishSnapshot(
    @CurrentUser() actor: PublicUser,
    @Body() input: UpdatePublicSiteConfigDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return {
      snapshot: await this.publicSite.refreshSnapshot(actor, input),
    };
  }
}
