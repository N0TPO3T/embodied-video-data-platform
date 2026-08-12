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
import { AiQualityPromptService } from "./ai-quality-prompt.service.js";
import { UpdateAiQualityPromptDto } from "./dto/update-ai-quality-prompt.dto.js";

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
  constructor(private readonly prompts: AiQualityPromptService) {}

  @Get("prompt")
  async getPrompt(
    @CurrentUser() actor: PublicUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return { prompt: publicPrompt(await this.prompts.getActive(actor)) };
  }

  @Put("prompt")
  @UseGuards(AllowedOriginGuard)
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
}
