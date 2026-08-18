import { createHash } from "node:crypto";

import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

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

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly buckets = new Map<string, Bucket>();
  private client: RedisClientType | null = null;
  private connecting: Promise<void> | null = null;

  async consume(options: RateLimitOptions): Promise<RateLimitResult> {
    if (this.useMemoryStore()) return this.consumeMemory(options);
    try {
      const client = await this.redisClient();
      const result = (await client.eval(CONSUME_SCRIPT, {
        keys: [this.redisKey(options.key)],
        arguments: [String(options.windowMs)],
      })) as [number, number];
      const count = Number(result[0]);
      const ttlMs = Math.max(1, Number(result[1]));
      return count <= options.limit
        ? { allowed: true }
        : {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1_000)),
          };
    } catch (error) {
      this.logger.error(
        `Redis 限流不可用，敏感请求按失败关闭：${error instanceof Error ? error.message : String(error)}`,
      );
      return { allowed: false, retryAfterSeconds: 1 };
    }
  }

  async reset(): Promise<void> {
    this.buckets.clear();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
  }

  private useMemoryStore(): boolean {
    return (
      process.env.NODE_ENV === "test" ||
      process.env.RATE_LIMIT_STORE === "memory"
    );
  }

  private consumeMemory(options: RateLimitOptions): RateLimitResult {
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

  private async redisClient(): Promise<RedisClientType> {
    if (!this.client) {
      const url = process.env.REDIS_URL;
      if (!url) throw new Error("REDIS_URL is required for distributed rate limiting");
      this.client = createClient({ url });
      this.client.on("error", (error) => {
        this.logger.error(`Redis client error: ${error.message}`);
      });
    }
    if (!this.client.isOpen) {
      this.connecting ??= this.client
        .connect()
        .then(() => undefined)
        .finally(() => {
          this.connecting = null;
        });
      await this.connecting;
    }
    return this.client;
  }

  private redisKey(key: string): string {
    const digest = createHash("sha256").update(key, "utf8").digest("hex");
    return `evdp:rate-limit:${digest}`;
  }

  private pruneExpired(nowMs: number): void {
    if (this.buckets.size < 1_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAtMs <= nowMs) this.buckets.delete(key);
    }
  }
}
