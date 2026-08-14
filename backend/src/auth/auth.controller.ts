import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { AuthService } from "./auth.service.js";
import {
  AuthFailure,
  type PublicUser,
} from "./auth.types.js";
import { CurrentUser } from "./current-user.decorator.js";
import { LoginDto } from "./dto/login.dto.js";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "./session-cookie.js";
import { SessionGuard } from "./session.guard.js";
import { LoginRateLimitGuard } from "../security/login-rate-limit.guard.js";

function homePath(user: PublicUser): string {
  if (user.role === "admin") return "/admin";
  if (user.role === "leader") return "/team";
  return "/collector";
}

function assertAllowedOrigin(request: Request): void {
  const allowed = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  if (request.headers.origin !== allowed) {
    throw new HttpException(
      { code: "FORBIDDEN", error: "请求来源无效" },
      403,
    );
  }
}

function rethrowAuthFailure(
  error: unknown,
  response: Response,
): never {
  if (error instanceof AuthFailure) {
    if (error.retryAfterSeconds) {
      response.setHeader("retry-after", String(error.retryAfterSeconds));
    }
    throw new HttpException(
      { code: error.code, error: error.message },
      error.status,
    );
  }
  throw error;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  @UseGuards(LoginRateLimitGuard)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser; homePath: string }> {
    assertAllowedOrigin(request);
    try {
      const result = await this.auth.login(input.username, input.password);
      setSessionCookie(response, result.token);
      return {
        user: result.user,
        homePath: homePath(result.user),
      };
    } catch (error) {
      rethrowAuthFailure(error, response);
    }
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    assertAllowedOrigin(request);
    await this.auth.logout(readSessionCookie(request));
    clearSessionCookie(response);
  }

  @Get("session")
  @UseGuards(SessionGuard)
  session(
    @CurrentUser() user: PublicUser,
  ): { user: PublicUser; homePath: string } {
    return { user, homePath: homePath(user) };
  }
}
