import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { PublicSiteSnapshotEntity } from "../database/entities/public-site-snapshot.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SecurityModule } from "../security/security.module.js";
import { PublicSiteController } from "./public-site.controller.js";
import { PublicSiteService } from "./public-site.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PublicSiteSnapshotEntity,
      SubmissionEntity,
      VideoQualityResultEntity,
      MediaMetadataEntity,
    ]),
    AuthModule,
    AuditModule,
    SecurityModule,
  ],
  controllers: [PublicSiteController],
  providers: [PublicSiteService, AllowedOriginGuard],
  exports: [PublicSiteService],
})
export class PublicSiteModule {}
