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
const LOGIN_IP_LIMIT = 100;

function clientKey(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimits: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const username =
      typeof request.body?.username === "string"
        ? normalizeUsername(request.body.username)
        : "";
    const ip = clientKey(request);
    const [ipResult, accountResult] = await Promise.all([
      this.rateLimits.consume({
        key: `login:ip:${ip}`,
        limit: LOGIN_IP_LIMIT,
        windowMs: LOGIN_WINDOW_MS,
      }),
      this.rateLimits.consume({
        key: `login:ip-account:${ip}:${username}`,
        limit: LOGIN_LIMIT,
        windowMs: LOGIN_WINDOW_MS,
      }),
    ]);
    const result = !ipResult.allowed ? ipResult : accountResult;

    if (!result.allowed) {
      rejectRateLimited(response, result.retryAfterSeconds);
    }
    return true;
  }
}
