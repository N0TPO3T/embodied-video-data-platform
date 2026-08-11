import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import type { PublicUser } from "./auth.types.js";

export type AuthenticatedRequest = Request & {
  user?: PublicUser;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new Error("Authenticated user missing from request");
    }
    return request.user;
  },
);
