import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import {
  CompleteUploadDto,
  CreateUploadDto,
  PresignPartsDto,
} from "./dto/upload.dto.js";
import { SubmissionFailureFilter } from "./submission-failure.filter.js";
import { SubmissionsService } from "./submissions.service.js";

@Controller("submissions")
@UseGuards(SessionGuard)
@UseFilters(SubmissionFailureFilter)
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Post("uploads")
  @UseGuards(AllowedOriginGuard)
  createUpload(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateUploadDto,
  ) {
    return this.submissions.createUpload(actor, input);
  }

  @Post(":id/uploads/parts")
  @UseGuards(AllowedOriginGuard)
  presignParts(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: PresignPartsDto,
  ) {
    return this.submissions.presignParts(actor, id, input.partNumbers);
  }

  @Post(":id/uploads/complete")
  @UseGuards(AllowedOriginGuard)
  completeUpload(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: CompleteUploadDto,
  ) {
    return this.submissions.completeUpload(actor, id, input);
  }

  @Delete(":id/uploads")
  @UseGuards(AllowedOriginGuard)
  async abortUpload(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ): Promise<void> {
    await this.submissions.abortUpload(actor, id);
  }

  @Get()
  async list(@CurrentUser() actor: PublicUser) {
    return { submissions: await this.submissions.list(actor) };
  }

  @Get(":id")
  async get(@CurrentUser() actor: PublicUser, @Param("id") id: string) {
    return { submission: await this.submissions.get(actor, id) };
  }
}
