import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { Response } from "express";

import type { AuthenticatedRequest } from "../auth/current-user.decorator.js";
import { RateLimitService } from "./rate-limit.service.js";
import { rejectRateLimited } from "./rate-limit-response.js";

const SENSITIVE_ACTION_LIMIT = 30;
const SENSITIVE_ACTION_WINDOW_MS = 60 * 1_000;

@Injectable()
export class SensitiveActionRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimits: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const actorId = request.user?.id ?? request.ip ?? "anonymous";
    const result = await this.rateLimits.consume({
      key: [
        "sensitive",
        actorId,
        request.method,
        request.route?.path ?? request.path,
      ].join(":"),
      limit: SENSITIVE_ACTION_LIMIT,
      windowMs: SENSITIVE_ACTION_WINDOW_MS,
    });

    if (!result.allowed) {
      rejectRateLimited(response, result.retryAfterSeconds);
    }
    return true;
  }
}
