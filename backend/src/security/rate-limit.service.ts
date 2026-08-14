import { Injectable } from "@nestjs/common";

export type RateLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      retryAfterSeconds: number;
    };

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
  now?: Date;
};

type Bucket = {
  count: number;
  resetAtMs: number;
};

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  consume(options: RateLimitOptions): RateLimitResult {
    const nowMs = options.now?.getTime() ?? Date.now();
    this.pruneExpired(nowMs);

    const existing = this.buckets.get(options.key);
    if (!existing || existing.resetAtMs <= nowMs) {
      this.buckets.set(options.key, {
        count: 1,
        resetAtMs: nowMs + options.windowMs,
      });
      return { allowed: true };
    }

    if (existing.count >= options.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.resetAtMs - nowMs) / 1_000),
        ),
      };
    }

    existing.count += 1;
    return { allowed: true };
  }

  reset(): void {
    this.buckets.clear();
  }

  private pruneExpired(nowMs: number): void {
    if (this.buckets.size < 1_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAtMs <= nowMs) {
        this.buckets.delete(key);
      }
    }
  }
}
