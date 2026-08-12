import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "../auth/auth.module.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { StorageModule } from "../storage/storage.module.js";
import { SubmissionFailureFilter } from "./submission-failure.filter.js";
import { SubmissionsController } from "./submissions.controller.js";
import { SubmissionsPolicy } from "./submissions.policy.js";
import { SubmissionsService } from "./submissions.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubmissionEntity,
      JobOutboxEntity,
      VideoQualityResultEntity,
    ]),
    AuthModule,
    StorageModule,
  ],
  controllers: [SubmissionsController],
  providers: [
    SubmissionsService,
    SubmissionsPolicy,
    SubmissionFailureFilter,
    AllowedOriginGuard,
  ],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
