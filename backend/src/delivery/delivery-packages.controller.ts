import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";
import { DeliveryFailureFilter } from "./delivery-failure.filter.js";
import { DeliveryPackagesService } from "./delivery-packages.service.js";
import {
  CreateDeliveryArchiveTaskDto,
  CreateDeliveryPackageDto,
} from "./dto/delivery-package.dto.js";

@Controller("delivery-packages")
@UseGuards(SessionGuard)
@UseFilters(DeliveryFailureFilter)
export class DeliveryPackagesController {
  constructor(private readonly packages: DeliveryPackagesService) {}

  @Get()
  async list(@CurrentUser() actor: PublicUser) {
    return { packages: await this.packages.list(actor) };
  }

  @Get("preview")
  async preview(@CurrentUser() actor: PublicUser) {
    return { preview: await this.packages.preview(actor) };
  }

  @Get(":id")
  async get(@CurrentUser() actor: PublicUser, @Param("id") id: string) {
    return { package: await this.packages.get(actor, id) };
  }

  @Get(":id/download-links")
  async downloadLinks(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return await this.packages.downloadLinks(actor, id);
  }

  @Get(":id/archive-tasks")
  async archiveTasks(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return { tasks: await this.packages.listArchiveTasks(actor, id) };
  }

  @Post(":id/archive-tasks")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async createArchiveTask(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: CreateDeliveryArchiveTaskDto,
  ) {
    return { task: await this.packages.createArchiveTask(actor, id, input) };
  }

  @Get(":id/archive-tasks/:taskId")
  async archiveTask(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
  ) {
    return { task: await this.packages.getArchiveTask(actor, id, taskId) };
  }

  @Get(":id/archive-tasks/:taskId/download-link")
  async archiveTaskDownloadLink(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
  ) {
    return await this.packages.archiveTaskDownloadLink(actor, id, taskId);
  }

  @Get(":id/manifest.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  async manifest(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const csv = await this.packages.manifestCsv(actor, id);
    response
      .setHeader(
        "content-disposition",
        `attachment; filename="${id}-manifest.csv"`,
      )
      .send(csv);
  }

  @Get(":id/archive.tar")
  async archiveTar(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const archive = await this.packages.archiveTar(actor, id);
    response
      .setHeader("content-type", "application/x-tar")
      .setHeader(
        "content-disposition",
        `attachment; filename="${archive.fileName}"`,
      );
    archive.stream.pipe(response);
  }

  @Get(":id/archive.zip")
  async archiveZip(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const archive = await this.packages.archiveZip(actor, id);
    response
      .setHeader("content-type", "application/zip")
      .setHeader(
        "content-disposition",
        `attachment; filename="${archive.fileName}"`,
      );
    archive.stream.pipe(response);
  }

  @Post()
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async create(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateDeliveryPackageDto,
  ) {
    return { package: await this.packages.create(actor, input) };
  }
}
