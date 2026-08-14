import { randomUUID } from "node:crypto";

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";

import {
  DELIVERY_ARCHIVE_GLOBAL_CONCURRENCY,
  DeliveryPackagesService,
  type DeliveryArchiveClaim,
} from "./delivery-packages.service.js";

const POLL_INTERVAL_MS = 250;

function workerEnabled(): boolean {
  return process.env.DELIVERY_ARCHIVE_WORKER_ENABLED !== "false";
}

@Injectable()
export class DeliveryArchiveWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DeliveryArchiveWorker.name);
  private readonly workerId = `delivery-archive-${process.pid}-${randomUUID()}`;
  private readonly active = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private pollPromise: Promise<void> | null = null;
  private started = false;

  constructor(private readonly delivery: DeliveryPackagesService) {}

  onApplicationBootstrap(): void {
    if (workerEnabled()) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => {
      void this.triggerPoll();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
    void this.triggerPoll();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.pollPromise) await this.pollPromise;
    await Promise.allSettled([...this.active]);
  }

  async processAvailableOnce(): Promise<number> {
    const available = Math.max(
      0,
      DELIVERY_ARCHIVE_GLOBAL_CONCURRENCY - this.active.size,
    );
    if (available === 0) return 0;
    const claims = await this.delivery.claimPendingArchiveTasks(
      this.workerId,
      available,
    );
    await Promise.all(claims.map((claim) => this.runClaim(claim, false)));
    return claims.length;
  }

  private triggerPoll(): Promise<void> {
    if (this.pollPromise) return this.pollPromise;
    const promise = this.poll().finally(() => {
      if (this.pollPromise === promise) this.pollPromise = null;
    });
    this.pollPromise = promise;
    return promise;
  }

  private async poll(): Promise<void> {
    if (!this.started) return;
    try {
      const available = Math.max(
        0,
        DELIVERY_ARCHIVE_GLOBAL_CONCURRENCY - this.active.size,
      );
      if (available === 0) return;
      const claims = await this.delivery.claimPendingArchiveTasks(
        this.workerId,
        available,
      );
      for (const claim of claims) void this.runClaim(claim, true);
    } catch (error) {
      this.logger.warn(`Failed to poll delivery archive tasks: ${String(error)}`);
    }
  }

  private runClaim(
    claim: DeliveryArchiveClaim,
    track: boolean,
  ): Promise<void> {
    const promise = this.delivery.processArchiveClaim(claim).catch((error) => {
      this.logger.warn(
        `Failed to process delivery archive task ${claim.taskId}: ${String(error)}`,
      );
    });
    if (!track) return promise;
    this.active.add(promise);
    void promise.finally(() => {
      this.active.delete(promise);
      if (this.started) void this.triggerPoll();
    });
    return promise;
  }
}
