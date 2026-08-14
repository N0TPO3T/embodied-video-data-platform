import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { normalizeUsername } from "../auth/auth.service.js";
import { RateLimitService } from "./rate-limit.service.js";
import { rejectRateLimited } from "./rate-limit-response.js";

const LOGIN_LIMIT = 20;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;

function clientKey(request: Request): string {
  const forwarded = request.headers["x-forwarded-for"];
  const forwardedFor = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return forwardedFor?.split(",")[0]?.trim() || request.ip || "unknown";
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimits: RateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const username =
      typeof request.body?.username === "string"
        ? normalizeUsername(request.body.username)
        : "";
    const result = this.rateLimits.consume({
      key: `login:${clientKey(request)}:${username}`,
      limit: LOGIN_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
    });

    if (!result.allowed) {
      rejectRateLimited(response, result.retryAfterSeconds);
    }
    return true;
  }
}
