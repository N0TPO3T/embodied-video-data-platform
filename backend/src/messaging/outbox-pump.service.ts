import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";

import { OutboxPublisherService } from "./outbox-publisher.service.js";

@Injectable()
export class OutboxPumpService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly publisher: OutboxPublisherService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.pump();
    }, 1_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.publisher.publishBatch();
    } catch {
      // Individual failures remain in the outbox; the next tick retries.
    } finally {
      this.running = false;
    }
  }
}
