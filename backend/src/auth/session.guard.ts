import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from "@nestjs/common";

import { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest } from "./current-user.decorator.js";
import { readSessionCookie } from "./session-cookie.js";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.auth.authenticate(readSessionCookie(request));
    if (!user) {
      throw new HttpException(
        { code: "UNAUTHENTICATED", error: "请先登录" },
        401,
      );
    }
    request.user = user;
    return true;
  }
}
