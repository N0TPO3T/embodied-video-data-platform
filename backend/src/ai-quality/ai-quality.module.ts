import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { VideoQualityPromptVersionEntity } from "../database/entities/video-quality-prompt-version.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { AiQualityController } from "./ai-quality.controller.js";
import { AiQualityPromptService } from "./ai-quality-prompt.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([VideoQualityPromptVersionEntity]),
    AuthModule,
    AuditModule,
  ],
  controllers: [AiQualityController],
  providers: [AiQualityPromptService, AllowedOriginGuard],
  exports: [AiQualityPromptService],
})
export class AiQualityModule {}
