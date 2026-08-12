import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class AllowedOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const allowed = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    if (request.headers.origin !== allowed) {
      throw new HttpException(
        { code: "FORBIDDEN", error: "请求来源无效" },
        403,
      );
    }
    return true;
  }
}
