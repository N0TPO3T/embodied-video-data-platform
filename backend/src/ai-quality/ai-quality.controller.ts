import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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
import { AiQualityPromptService } from "./ai-quality-prompt.service.js";
import { CreateLabelDto, UpdateLabelDto } from "./dto/label-set.dto.js";
import { CreateQualityRuleDto } from "./dto/quality-rule.dto.js";
import { PublishScarcityConfigDto } from "./dto/scarcity-config.dto.js";
import { UpdateAiQualityPromptDto } from "./dto/update-ai-quality-prompt.dto.js";
import { LabelSetService, publicLabelSet } from "./label-set.service.js";
import {
  publicQualityRule,
  QualityRuleService,
} from "./quality-rule.service.js";
import {
  publicScarcityConfig,
  ScarcityConfigService,
} from "./scarcity-config.service.js";

function publicPrompt(prompt: Awaited<ReturnType<AiQualityPromptService["getActive"]>>) {
  return {
    id: prompt.id,
    revision: prompt.revision,
    systemPrompt: prompt.systemPrompt,
    contentSha256: prompt.contentSha256,
    promptVersion: prompt.promptVersion,
    ruleVersion: prompt.ruleVersion,
    outputSchema: prompt.outputSchema,
    initialModel: prompt.initialModel,
    reviewModel: prompt.reviewModel,
    createdByName: prompt.createdByName,
    createdAt: prompt.createdAt.getTime(),
  };
}

@Controller("ai-quality")
@UseGuards(SessionGuard)
@UseFilters(IdentityFailureFilter)
export class AiQualityController {
  constructor(
    private readonly prompts: AiQualityPromptService,
    private readonly rules: QualityRuleService,
    private readonly labelSets: LabelSetService,
    private readonly scarcityConfigs: ScarcityConfigService,
  ) {}

  @Get("prompt")
  async getPrompt(
    @CurrentUser() actor: PublicUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return { prompt: publicPrompt(await this.prompts.getActive(actor)) };
  }

  @Put("prompt")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async updatePrompt(
    @CurrentUser() actor: PublicUser,
    @Body() input: UpdateAiQualityPromptDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return {
      prompt: publicPrompt(await this.prompts.update(actor, input.systemPrompt)),
    };
  }

  @Get("quality-rule")
  async getQualityRule(
    @CurrentUser() actor: PublicUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return {
      rule: publicQualityRule(await this.rules.getActive(actor)),
    };
  }

  @Put("quality-rule")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async createQualityRule(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateQualityRuleDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return {
      rule: publicQualityRule(await this.rules.create(actor, input)),
    };
  }

  @Get("label-set")
  async getLabelSet(
    @CurrentUser() actor: PublicUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return {
      labelSet: publicLabelSet(await this.labelSets.getActive(actor)),
    };
  }

  @Put("labels/:id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async updateLabel(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: UpdateLabelDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return {
      labelSet: publicLabelSet(
        await this.labelSets.updateLabel(actor, { ...input, id }),
      ),
    };
  }

  @Post("labels")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async createLabel(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateLabelDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return {
      labelSet: publicLabelSet(await this.labelSets.createLabel(actor, input)),
    };
  }

  @Delete("labels/:id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async deleteLabel(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return {
      labelSet: publicLabelSet(await this.labelSets.deleteLabel(actor, id)),
    };
  }

  @Get("scarcity-config")
  async getScarcityConfig(
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return {
      scarcityConfig: publicScarcityConfig(
        await this.scarcityConfigs.getActive(),
      ),
    };
  }

  @Put("scarcity-config")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async publishScarcityConfig(
    @CurrentUser() actor: PublicUser,
    @Body() input: PublishScarcityConfigDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return {
      scarcityConfig: publicScarcityConfig(
        await this.scarcityConfigs.publish(actor, input),
      ),
    };
  }
}
