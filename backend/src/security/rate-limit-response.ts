import { HttpException } from "@nestjs/common";
import type { Response } from "express";

export function rejectRateLimited(
  response: Response | undefined,
  retryAfterSeconds: number,
): never {
  response?.setHeader("retry-after", String(retryAfterSeconds));
  throw new HttpException(
    {
      code: "RATE_LIMITED",
      error: "操作过于频繁，请稍后再试",
    },
    429,
  );
}
