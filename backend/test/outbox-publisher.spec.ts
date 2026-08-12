import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import { createDataSource } from "../src/database/data-source.js";
import { JobOutboxEntity } from "../src/database/entities/job-outbox.entity.js";
import type {
  MessageBusPort,
  PublishMessage,
} from "../src/messaging/message-bus.port.js";
import { OutboxPublisherService } from "../src/messaging/outbox-publisher.service.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

class RecordingBus implements MessageBusPort {
  published: PublishMessage[] = [];
  failMessageId: string | null = null;

  async publish(message: PublishMessage): Promise<void> {
    if (message.messageId === this.failMessageId) {
      throw new Error("broker unavailable");
    }
    this.published.push(message);
  }

  async close(): Promise<void> {}
}

describe("outbox publisher", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.getRepository(JobOutboxEntity).clear();
  });

  it("marks only confirmed messages published and retries failures later", async () => {
    const readyAt = new Date("2026-08-07T00:00:00.000Z");
    const successId = `JOB-${randomUUID()}`;
    const failureId = `JOB-${randomUUID()}`;
    await dataSource.getRepository(JobOutboxEntity).save([
      {
        id: successId,
        aggregateType: "submission",
        aggregateId: `SUB-${randomUUID()}`,
        eventType: "media.probe.v1",
        payload: { submissionId: "SUB-SUCCESS" },
        status: "pending",
        attempts: 0,
        availableAt: readyAt,
      },
      {
        id: failureId,
        aggregateType: "submission",
        aggregateId: `SUB-${randomUUID()}`,
        eventType: "media.probe.v1",
        payload: { submissionId: "SUB-FAILURE" },
        status: "pending",
        attempts: 0,
        availableAt: readyAt,
      },
    ]);

    const bus = new RecordingBus();
    bus.failMessageId = failureId;
    const publisher = new OutboxPublisherService(dataSource, bus);
    const result = await publisher.publishBatch(10, readyAt);

    expect(result).toEqual({ examined: 2, published: 1, failed: 1 });
    expect(bus.published).toEqual([
      {
        messageId: successId,
        routingKey: "media.probe.v1",
        payload: { submissionId: "SUB-SUCCESS" },
      },
    ]);

    const success = await dataSource
      .getRepository(JobOutboxEntity)
      .findOneByOrFail({ id: successId });
    const failure = await dataSource
      .getRepository(JobOutboxEntity)
      .findOneByOrFail({ id: failureId });
    expect(success.status).toBe("published");
    expect(success.attempts).toBe(1);
    expect(success.publishedAt).toEqual(readyAt);
    expect(failure.status).toBe("pending");
    expect(failure.attempts).toBe(1);
    expect(failure.lastError).toBe("broker unavailable");
    expect(failure.availableAt.getTime()).toBeGreaterThan(
      readyAt.getTime(),
    );

    bus.failMessageId = null;
    const retried = await publisher.publishBatch(
      10,
      new Date(failure.availableAt.getTime() + 1),
    );
    expect(retried).toEqual({ examined: 1, published: 1, failed: 0 });
    expect(
      await dataSource.getRepository(JobOutboxEntity).findOneByOrFail({
        id: failureId,
      }),
    ).toMatchObject({ status: "published", attempts: 2 });
  });
});
