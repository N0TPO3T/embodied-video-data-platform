import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "../auth/auth.module.js";
import { AnnotationReviewEntity } from "../database/entities/annotation-review.entity.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { TaskSegmentAssetEntity } from "../database/entities/task-segment-asset.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { OperationsFailureFilter } from "../operations/operations-failure.filter.js";
import { SecurityModule } from "../security/security.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { TaskSegmentController } from "./task-segment.controller.js";
import { TaskSegmentMediaTool } from "./task-segment-media.js";
import { TaskSegmentProcessor } from "./task-segment.processor.js";
import { TaskSegmentService } from "./task-segment.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnnotationReviewEntity,
      AnnotationRunEntity,
      JobOutboxEntity,
      MediaMetadataEntity,
      SubmissionEntity,
      TaskSegmentAssetEntity,
    ]),
    AuthModule,
    SecurityModule,
    StorageModule,
  ],
  controllers: [TaskSegmentController],
  providers: [
    TaskSegmentService,
    TaskSegmentMediaTool,
    TaskSegmentProcessor,
    AllowedOriginGuard,
    OperationsFailureFilter,
  ],
  exports: [TaskSegmentProcessor],
})
export class TaskSegmentModule {}
