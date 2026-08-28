import type {
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
} from "amqplib";
import { vi } from "vitest";

import {
  MEDIA_QUEUE,
  TASK_SEGMENT_QUEUE,
} from "../src/messaging/rabbitmq-topology.js";
import { RabbitMediaWorker } from "../src/media/rabbit-media-worker.js";

describe("media worker", () => {
  it("consumes task segment jobs in the existing media worker", async () => {
    const consumers = new Map<string, (message: ConsumeMessage | null) => void>();
    const ack = vi.fn();
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockImplementation(
        async (queue: string, handler: (message: ConsumeMessage | null) => void) => {
          consumers.set(queue, handler);
          return { consumerTag: `${queue}-test` };
        },
      ),
      sendToQueue: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      ack,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChannelModel;
    const connector = vi.fn().mockResolvedValue(connection);
    const analysis = { process: vi.fn().mockResolvedValue("processed") };
    const taskSegments = { process: vi.fn().mockResolvedValue("ready") };
    const worker = new RabbitMediaWorker(
      analysis as never,
      undefined,
      taskSegments as never,
    );
    await worker.start("amqp://test", connector);
    expect(consumers.has(MEDIA_QUEUE)).toBe(true);
    expect(consumers.has(TASK_SEGMENT_QUEUE)).toBe(true);

    const message = {
      content: Buffer.from(JSON.stringify({
        assetId: "TSA-WORKER",
        submissionId: "SUB-WORKER",
      })),
      fields: { redelivered: false },
      properties: { headers: {} },
    } as unknown as ConsumeMessage;
    consumers.get(TASK_SEGMENT_QUEUE)?.(message);
    await vi.waitFor(() => expect(ack).toHaveBeenCalledWith(message));
    expect(taskSegments.process).toHaveBeenCalledWith({
      assetId: "TSA-WORKER",
      recoverProcessing: false,
    });
    expect(analysis.process).not.toHaveBeenCalled();
    expect(channel.sendToQueue).not.toHaveBeenCalled();
    await worker.close();
  });

  it("delays a lock-busy recovery delivery without exhausting retries", async () => {
    let consumer: ((message: ConsumeMessage | null) => void) | undefined;
    const waitForConfirms = vi.fn().mockResolvedValue(undefined);
    const ack = vi.fn();
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockImplementation(
        async (
          _queue: string,
          handler: (message: ConsumeMessage | null) => void,
        ) => {
          consumer = handler;
          return { consumerTag: "media-test" };
        },
      ),
      sendToQueue: vi.fn().mockReturnValue(true),
      waitForConfirms,
      ack,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChannelModel;
    const connector = vi.fn().mockResolvedValue(connection);
    const analysis = {
      process: vi.fn().mockResolvedValue("lock_busy"),
    };
    const worker = new RabbitMediaWorker(analysis as never);
    await worker.start("amqp://test", connector);

    const message = {
      content: Buffer.from(JSON.stringify({ submissionId: "SUB-MEDIA-BUSY" })),
      properties: { headers: { "retry-attempt": 3 } },
    } as unknown as ConsumeMessage;
    consumer?.(message);

    await vi.waitFor(() => {
      expect(ack).toHaveBeenCalledWith(message);
    });
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      `${MEDIA_QUEUE}.retry.3`,
      message.content,
      expect.objectContaining({
        headers: { "retry-attempt": 3 },
        persistent: true,
      }),
    );
    expect(waitForConfirms).toHaveBeenCalledOnce();
    expect(waitForConfirms.mock.invocationCallOrder[0]).toBeLessThan(
      ack.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    await worker.close();
  });

  it("keeps retrying when a state persistence write fails", async () => {
    let consumer: ((message: ConsumeMessage | null) => void) | undefined;
    const waitForConfirms = vi.fn().mockResolvedValue(undefined);
    const ack = vi.fn();
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockImplementation(
        async (
          _queue: string,
          handler: (message: ConsumeMessage | null) => void,
        ) => {
          consumer = handler;
          return { consumerTag: "media-test" };
        },
      ),
      sendToQueue: vi.fn().mockReturnValue(true),
      waitForConfirms,
      ack,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChannelModel;
    const connector = vi.fn().mockResolvedValue(connection);
    const analysis = {
      process: vi.fn().mockRejectedValue(new Error("database update failed")),
    };
    const worker = new RabbitMediaWorker(analysis as never);
    await worker.start("amqp://test", connector);

    const message = {
      content: Buffer.from(
        JSON.stringify({ submissionId: "SUB-MEDIA-DB-FAIL" }),
      ),
      properties: { headers: { "retry-attempt": 3 } },
    } as unknown as ConsumeMessage;
    consumer?.(message);

    await vi.waitFor(() => {
      expect(ack).toHaveBeenCalledOnce();
    });
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      `${MEDIA_QUEUE}.retry.3`,
      message.content,
      expect.objectContaining({
        headers: { "retry-attempt": 3 },
        persistent: true,
      }),
    );
    expect(waitForConfirms).toHaveBeenCalledOnce();
    expect(waitForConfirms.mock.invocationCallOrder[0]).toBeLessThan(
      ack.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    await worker.close();
  });

  it("keeps heartbeat failures out of the business ACK path", async () => {
    let consumer: ((message: ConsumeMessage | null) => void) | undefined;
    const ack = vi.fn();
    const sendToQueue = vi.fn().mockReturnValue(true);
    const waitForConfirms = vi.fn().mockResolvedValue(undefined);
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockImplementation(
        async (
          _queue: string,
          handler: (message: ConsumeMessage | null) => void,
        ) => {
          consumer = handler;
          return { consumerTag: "media-test" };
        },
      ),
      sendToQueue,
      waitForConfirms,
      ack,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChannelModel;
    const connector = vi.fn().mockResolvedValue(connection);
    const analysis = {
      process: vi.fn().mockResolvedValue("processed"),
    };
    const heartbeats = {
      start: vi.fn().mockResolvedValue("media-heartbeat-test"),
      beat: vi.fn().mockRejectedValue(new Error("heartbeat unavailable")),
      recordTaskFinished: vi
        .fn()
        .mockRejectedValue(new Error("metrics unavailable")),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new RabbitMediaWorker(
      analysis as never,
      heartbeats as never,
    );
    await worker.start("amqp://test", connector);

    const message = {
      content: Buffer.from(
        JSON.stringify({ submissionId: "SUB-MEDIA-HEARTBEAT" }),
      ),
      properties: { headers: {} },
    } as unknown as ConsumeMessage;
    consumer?.(message);

    await vi.waitFor(() => {
      expect(ack).toHaveBeenCalledOnce();
    });
    expect(ack).toHaveBeenCalledWith(message);
    expect(analysis.process).toHaveBeenCalledOnce();
    expect(analysis.process).toHaveBeenCalledWith({
      submissionId: "SUB-MEDIA-HEARTBEAT",
    });
    expect(heartbeats.beat).toHaveBeenCalledTimes(2);
    expect(heartbeats.beat).toHaveBeenNthCalledWith(
      2,
      "media-heartbeat-test",
      expect.objectContaining({
        status: "idle",
        currentSubmissionId: null,
        currentTaskStartedAt: null,
      }),
    );
    expect(heartbeats.recordTaskFinished).toHaveBeenCalledOnce();
    expect(sendToQueue).not.toHaveBeenCalled();
    expect(waitForConfirms).not.toHaveBeenCalled();
    await worker.close();
  });
});
