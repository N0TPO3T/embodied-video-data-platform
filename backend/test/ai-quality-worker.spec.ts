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
  it("uses RabbitMQ prefetch 2 and consumes the durable AI queue", async () => {
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

    await worker.start("amqp://test", aiQualityConcurrency("2"), connector);

    expect(channel.prefetch).toHaveBeenCalledWith(2);
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
});
