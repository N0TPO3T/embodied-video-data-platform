import { Injectable } from "@nestjs/common";
import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";

import {
  MediaAnalysisService,
  RetryableMediaError,
} from "./media-analysis.service.js";
import {
  assertMediaTopology,
  EVENTS_EXCHANGE,
  MEDIA_QUEUE,
} from "../messaging/rabbitmq-topology.js";

const RETRY_DELAYS = [5_000, 30_000, 120_000] as const;

@Injectable()
export class RabbitMediaWorker {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;

  constructor(private readonly analysis: MediaAnalysisService) {}

  async start(url: string): Promise<void> {
    this.connection = await connect(url);
    this.channel = await this.connection.createConfirmChannel();
    await assertMediaTopology(this.channel);
    for (const [index, delay] of RETRY_DELAYS.entries()) {
      await this.channel.assertQueue(`${MEDIA_QUEUE}.retry.${index + 1}`, {
        durable: true,
        arguments: {
          "x-message-ttl": delay,
          "x-dead-letter-exchange": EVENTS_EXCHANGE,
          "x-dead-letter-routing-key": "media.probe.v1",
        },
      });
    }
    await this.channel.prefetch(1);
    await this.channel.consume(MEDIA_QUEUE, (message) => {
      if (message) void this.handle(message);
    });
  }

  async close(): Promise<void> {
    if (this.channel) await this.channel.close().catch(() => undefined);
    if (this.connection) {
      await this.connection.close().catch(() => undefined);
    }
    this.channel = null;
    this.connection = null;
  }

  private async handle(message: ConsumeMessage): Promise<void> {
    const channel = this.channel;
    if (!channel) return;
    const retryAttempt = Number(
      message.properties.headers?.["retry-attempt"] ?? 0,
    );
    try {
      const payload = JSON.parse(message.content.toString("utf8")) as {
        submissionId?: unknown;
      };
      if (typeof payload.submissionId !== "string") {
        throw new Error("media job submissionId is invalid");
      }
      await this.analysis.process({ submissionId: payload.submissionId });
      channel.ack(message);
    } catch (error) {
      if (
        error instanceof RetryableMediaError &&
        retryAttempt < RETRY_DELAYS.length
      ) {
        channel.sendToQueue(
          `${MEDIA_QUEUE}.retry.${retryAttempt + 1}`,
          message.content,
          {
            ...message.properties,
            headers: {
              ...message.properties.headers,
              "retry-attempt": retryAttempt + 1,
            },
            persistent: true,
          },
        );
        await channel.waitForConfirms();
      }
      channel.ack(message);
    }
  }
}
