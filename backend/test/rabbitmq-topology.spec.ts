import type { ConfirmChannel } from "amqplib";
import { vi } from "vitest";

import {
  AI_QUALITY_QUEUE,
  AI_QUALITY_QUEUE_OPTIONS,
  assertAiQualityTopology,
  assertMediaTopology,
  EVENTS_EXCHANGE,
  MEDIA_QUEUE,
  MEDIA_QUEUE_OPTIONS,
} from "../src/messaging/rabbitmq-topology.js";

describe("RabbitMQ media topology", () => {
  it("declares one shared durable main queue with the dead-letter exchange", async () => {
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;

    await assertMediaTopology(channel);

    expect(channel.assertExchange).toHaveBeenCalledWith(
      EVENTS_EXCHANGE,
      "topic",
      { durable: true },
    );
    expect(channel.assertQueue).toHaveBeenCalledWith(
      MEDIA_QUEUE,
      MEDIA_QUEUE_OPTIONS,
    );
    expect(MEDIA_QUEUE_OPTIONS.arguments).toEqual({
      "x-dead-letter-exchange": "evdp.events.dead",
    });
  });
});

describe("RabbitMQ AI quality topology", () => {
  it("declares a durable AI queue with dead-letter routing", async () => {
    const channel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;

    await assertAiQualityTopology(channel);

    expect(channel.assertQueue).toHaveBeenCalledWith(
      AI_QUALITY_QUEUE,
      AI_QUALITY_QUEUE_OPTIONS,
    );
    expect(AI_QUALITY_QUEUE_OPTIONS.arguments).toEqual({
      "x-dead-letter-exchange": "evdp.events.dead",
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      AI_QUALITY_QUEUE,
      EVENTS_EXCHANGE,
      "ai.quality.v1",
    );
  });
});
