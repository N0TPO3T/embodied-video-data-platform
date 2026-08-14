import type {
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
} from "amqplib";
import { vi } from "vitest";

import { aiQualityConcurrency } from "../src/ai-quality/ai-quality.config.js";
import { RabbitAiQualityWorker } from "../src/ai-quality/rabbit-ai-quality-worker.js";
import { AI_QUALITY_QUEUE } from "../src/messaging/rabbitmq-topology.js";

describe("AI quality worker", () => {
  it("uses RabbitMQ prefetch 3 and consumes the durable AI queue", async () => {
    let consumer: ((message: ConsumeMessage | null) => void) | undefined;
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockImplementation(
        async (_queue: string, handler: (message: ConsumeMessage | null) => void) => {
          consumer = handler;
          return { consumerTag: "ai-quality-test" };
        },
      ),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChannelModel;
    const connector = vi.fn().mockResolvedValue(connection);
    const analysis = {
      process: vi.fn().mockResolvedValue("processed"),
      markTerminalFailure: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new RabbitAiQualityWorker(analysis as never);

    await worker.start("amqp://test", aiQualityConcurrency("3"), connector);

    expect(channel.prefetch).toHaveBeenCalledWith(3);
    expect(channel.consume).toHaveBeenCalledWith(
      AI_QUALITY_QUEUE,
      expect.any(Function),
    );
    expect(consumer).toBeTypeOf("function");
    await worker.close();
  });

  it("rejects an invalid concurrency value", () => {
    expect(() => aiQualityConcurrency("0")).toThrow(
      "AI_QUALITY_CONCURRENCY",
    );
    expect(() => aiQualityConcurrency("2.5")).toThrow(
      "AI_QUALITY_CONCURRENCY",
    );
  });

  it("requeues stalled tasks after the AI model timeout", async () => {
    const previousTimeout = process.env.AI_QUALITY_MODEL_TIMEOUT_MS;
    process.env.AI_QUALITY_MODEL_TIMEOUT_MS = "10000";
    vi.useFakeTimers();
    try {
      let consumer: ((message: ConsumeMessage | null) => void) | undefined;
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
            return { consumerTag: "ai-quality-test" };
          },
        ),
        sendToQueue: vi.fn().mockReturnValue(true),
        waitForConfirms: vi.fn().mockResolvedValue(undefined),
        ack: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as ConfirmChannel;
      const connection = {
        createConfirmChannel: vi.fn().mockResolvedValue(channel),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChannelModel;
      const connector = vi.fn().mockResolvedValue(connection);
      const analysis = {
        // Simulates an older provider that completely ignores AbortSignal.
        process: vi.fn(
          (_input: { signal?: AbortSignal }) =>
            new Promise<never>(() => undefined),
        ),
        markTerminalFailure: vi.fn().mockResolvedValue(undefined),
      };
      const worker = new RabbitAiQualityWorker(analysis as never);
      await worker.start("amqp://test", 1, connector);

      const message = {
        content: Buffer.from(JSON.stringify({ submissionId: "SUB-TIMEOUT" })),
        properties: { headers: { "retry-attempt": 3 } },
      } as unknown as ConsumeMessage;
      consumer?.(message);

      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(() => {
        expect(channel.ack).toHaveBeenCalledWith(message);
      });

      expect(analysis.process).toHaveBeenCalledWith({
        submissionId: "SUB-TIMEOUT",
        signal: expect.any(AbortSignal),
        terminalOnRetryableFailure: true,
      });
      expect(analysis.process.mock.calls[0]?.[0].signal?.aborted).toBe(true);
      expect(channel.sendToQueue).toHaveBeenCalledWith(
        `${AI_QUALITY_QUEUE}.retry.3`,
        message.content,
        expect.objectContaining({
          headers: { "retry-attempt": 3 },
          persistent: true,
        }),
      );
      expect(channel.waitForConfirms).toHaveBeenCalled();
      expect(analysis.markTerminalFailure).not.toHaveBeenCalled();
      await worker.close();
    } finally {
      vi.useRealTimers();
      if (previousTimeout === undefined) {
        delete process.env.AI_QUALITY_MODEL_TIMEOUT_MS;
      } else {
        process.env.AI_QUALITY_MODEL_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  it("keeps delaying a lock-busy reclaimed delivery after normal retries are exhausted", async () => {
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
          return { consumerTag: "ai-quality-test" };
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
      markTerminalFailure: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new RabbitAiQualityWorker(analysis as never);
    await worker.start("amqp://test", 1, connector);

    const message = {
      content: Buffer.from(JSON.stringify({ submissionId: "SUB-AI-BUSY" })),
      properties: { headers: { "retry-attempt": 3 } },
    } as unknown as ConsumeMessage;
    consumer?.(message);

    await vi.waitFor(() => {
      expect(ack).toHaveBeenCalledWith(message);
    });
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      `${AI_QUALITY_QUEUE}.retry.3`,
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
    expect(analysis.markTerminalFailure).not.toHaveBeenCalled();
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
          return { consumerTag: "ai-quality-test" };
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
    const worker = new RabbitAiQualityWorker(analysis as never);
    await worker.start("amqp://test", 1, connector);

    const message = {
      content: Buffer.from(JSON.stringify({ submissionId: "SUB-AI-DB-FAIL" })),
      properties: { headers: { "retry-attempt": 3 } },
    } as unknown as ConsumeMessage;
    consumer?.(message);

    await vi.waitFor(() => {
      expect(ack).toHaveBeenCalledOnce();
    });
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      `${AI_QUALITY_QUEUE}.retry.3`,
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
          return { consumerTag: "ai-quality-test" };
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
      start: vi.fn().mockResolvedValue("ai-quality-heartbeat-test"),
      beat: vi.fn().mockRejectedValue(new Error("heartbeat unavailable")),
      recordTaskFinished: vi
        .fn()
        .mockRejectedValue(new Error("metrics unavailable")),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new RabbitAiQualityWorker(
      analysis as never,
      heartbeats as never,
    );
    await worker.start("amqp://test", 1, connector);

    const message = {
      content: Buffer.from(JSON.stringify({ submissionId: "SUB-AI-HEARTBEAT" })),
      properties: { headers: {} },
    } as unknown as ConsumeMessage;
    consumer?.(message);

    await vi.waitFor(() => {
      expect(ack).toHaveBeenCalledOnce();
    });
    expect(ack).toHaveBeenCalledWith(message);
    expect(analysis.process).toHaveBeenCalledOnce();
    expect(analysis.process).toHaveBeenCalledWith({
      submissionId: "SUB-AI-HEARTBEAT",
      signal: expect.any(AbortSignal),
      terminalOnRetryableFailure: false,
    });
    expect(heartbeats.beat).toHaveBeenCalledTimes(2);
    expect(heartbeats.beat).toHaveBeenNthCalledWith(
      2,
      "ai-quality-heartbeat-test",
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
