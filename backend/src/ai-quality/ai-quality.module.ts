import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { LabelSetVersionEntity } from "../database/entities/label-set-version.entity.js";
import { QualityRuleVersionEntity } from "../database/entities/quality-rule-version.entity.js";
import { VideoQualityPromptVersionEntity } from "../database/entities/video-quality-prompt-version.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SecurityModule } from "../security/security.module.js";
import { AiQualityController } from "./ai-quality.controller.js";
import { AiQualityPromptService } from "./ai-quality-prompt.service.js";
import { LabelSetService } from "./label-set.service.js";
import { QualityRuleService } from "./quality-rule.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VideoQualityPromptVersionEntity,
      QualityRuleVersionEntity,
      LabelSetVersionEntity,
    ]),
    AuthModule,
    AuditModule,
    SecurityModule,
  ],
  controllers: [AiQualityController],
  providers: [
    AiQualityPromptService,
    QualityRuleService,
    LabelSetService,
    AllowedOriginGuard,
  ],
  exports: [AiQualityPromptService, QualityRuleService, LabelSetService],
})
export class AiQualityModule {}
