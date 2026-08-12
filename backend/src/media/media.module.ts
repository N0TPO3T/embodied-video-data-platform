import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { DatabaseModule } from "../database/database.module.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "../database/entities/media-segment.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { StorageModule } from "../storage/storage.module.js";
import { MediaAnalysisService } from "./media-analysis.service.js";
import { FfmpegMediaCommandRunner } from "./media-command-runner.js";
import { MEDIA_COMMAND_RUNNER } from "./media.tokens.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      SubmissionEntity,
      MediaMetadataEntity,
      MediaSegmentEntity,
    ]),
    StorageModule,
  ],
  providers: [
    MediaAnalysisService,
    {
      provide: MEDIA_COMMAND_RUNNER,
      useFactory: () => new FfmpegMediaCommandRunner(),
    },
  ],
  exports: [MediaAnalysisService],
})
export class MediaModule {}
