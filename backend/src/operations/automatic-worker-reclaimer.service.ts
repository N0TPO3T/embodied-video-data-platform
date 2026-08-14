import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { basename } from "node:path";

import type { PublicUser } from "../auth/auth.types.js";
import { OperationsService } from "./operations.service.js";

const RECLAIM_INTERVAL_MS = 30_000;
const SYSTEM_ACTOR: PublicUser = {
  id: "SYSTEM",
  displayName: "系统自动任务",
  username: "system",
  role: "admin",
  status: "active",
  updatedAt: 0,
};

function automaticReclaimEnabled(): boolean {
  return (
    process.env.EVDP_AUTO_RECLAIM_WORKER_TIMEOUTS === "true" &&
    basename(process.argv[1] ?? "") === "main.js"
  );
}

@Injectable()
export class AutomaticWorkerReclaimerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutomaticWorkerReclaimerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly operations: OperationsService) {}

  onModuleInit(): void {
    if (!automaticReclaimEnabled()) return;
    this.timer = setInterval(() => {
      void this.reclaim();
    }, RECLAIM_INTERVAL_MS);
    this.timer.unref();
    void this.reclaim();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async reclaim(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.operations.reclaimTimedOutTasks(
        SYSTEM_ACTOR,
      );
      if (result.reclaimed.length > 0) {
        this.logger.warn(
          `Reclaimed ${result.reclaimed.length} timed out worker task(s)`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to reclaim timed out worker tasks: ${String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
