import { Inject, Injectable } from "@nestjs/common";
import { DataSource, LessThanOrEqual } from "typeorm";

import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import {
  MESSAGE_BUS,
  type MessageBusPort,
} from "./message-bus.port.js";

function backoffMilliseconds(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}

@Injectable()
export class OutboxPublisherService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(MESSAGE_BUS) private readonly bus: MessageBusPort,
  ) {}

  async publishBatch(
    limit = 50,
    now = new Date(),
  ): Promise<{ examined: number; published: number; failed: number }> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(JobOutboxEntity);
      const events = await repository
        .createQueryBuilder("event")
        .setLock("pessimistic_write")
        .setOnLocked("skip_locked")
        .where("event.status = :status", { status: "pending" })
        .andWhere("event.availableAt <= :now", { now })
        .orderBy("event.createdAt", "ASC")
        .addOrderBy("event.id", "ASC")
        .take(Math.max(1, Math.min(limit, 100)))
        .getMany();
      let published = 0;
      let failed = 0;

      for (const event of events) {
        try {
          await this.bus.publish({
            messageId: event.id,
            routingKey: event.eventType,
            payload: event.payload,
          });
          event.status = "published";
          event.attempts += 1;
          event.publishedAt = now;
          event.lastError = null;
          published += 1;
        } catch (error) {
          event.status = "pending";
          event.attempts += 1;
          event.availableAt = new Date(
            now.getTime() + backoffMilliseconds(event.attempts),
          );
          event.lastError = (
            error instanceof Error ? error.message : "消息发布失败"
          ).slice(0, 1_000);
          failed += 1;
        }
        await repository.save(event);
      }
      return { examined: events.length, published, failed };
    });
  }

  async pendingCount(now = new Date()): Promise<number> {
    return this.dataSource.getRepository(JobOutboxEntity).countBy({
      status: "pending",
      availableAt: LessThanOrEqual(now),
    });
  }
}
