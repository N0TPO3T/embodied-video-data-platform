import { Module } from "@nestjs/common";

import { LoginRateLimitGuard } from "./login-rate-limit.guard.js";
import { RateLimitService } from "./rate-limit.service.js";
import { SensitiveActionRateLimitGuard } from "./sensitive-action-rate-limit.guard.js";

@Module({
  providers: [
    RateLimitService,
    LoginRateLimitGuard,
    SensitiveActionRateLimitGuard,
  ],
  exports: [
    RateLimitService,
    LoginRateLimitGuard,
    SensitiveActionRateLimitGuard,
  ],
})
export class SecurityModule {}
