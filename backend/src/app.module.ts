import { Module } from "@nestjs/common";

import { AiQualityModule } from "./ai-quality/ai-quality.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { SubmissionsModule } from "./submissions/submissions.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    IdentityModule,
    MessagingModule,
    SubmissionsModule,
    AiQualityModule,
    HealthModule,
  ],
})
export class AppModule {}
