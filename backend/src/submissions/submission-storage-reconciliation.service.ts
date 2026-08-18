import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";

import { SubmissionsService } from "./submissions.service.js";

@Injectable()
export class SubmissionStorageReconciliationService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(
    SubmissionStorageReconciliationService.name,
  );
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly submissions: SubmissionsService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test") return;
    const configured = Number(
      process.env.SUBMISSION_STORAGE_RECONCILE_INTERVAL_MS ?? "30000",
    );
    const intervalMs =
      Number.isFinite(configured) && configured >= 5_000
        ? configured
        : 30_000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.submissions.reconcileStorageOperations();
      if (result.completedUploads > 0 || result.completedDeletes > 0) {
        this.logger.log(
          `storage reconciliation recovered uploads=${result.completedUploads} deletes=${result.completedDeletes}`,
        );
      }
      if (result.failures > 0) {
        this.logger.warn(
          `storage reconciliation left ${result.failures} operation(s) pending for retry`,
        );
      }
    } catch (error) {
      this.logger.error(
        `storage reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
