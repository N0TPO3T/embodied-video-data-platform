import { Injectable } from "@nestjs/common";
import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";

import {
  AI_QUALITY_QUEUE,
  AI_QUALITY_ROUTING_KEY,
  assertAiQualityTopology,
  EVENTS_EXCHANGE,
} from "../messaging/rabbitmq-topology.js";
import {
  AiQualityAnalysisService,
  RetryableAiQualityError,
} from "./ai-quality-analysis.service.js";

const RETRY_DELAYS = [5_000, 30_000, 120_000] as const;

type RabbitConnector = typeof connect;

@Injectable()
export class RabbitAiQualityWorker {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;

  constructor(private readonly analysis: AiQualityAnalysisService) {}

  async start(
    url: string,
    concurrency: number,
    connector: RabbitConnector = connect,
  ): Promise<void> {
    this.connection = await connector(url);
    this.channel = await this.connection.createConfirmChannel();
    await assertAiQualityTopology(this.channel);
    for (const [index, delay] of RETRY_DELAYS.entries()) {
      await this.channel.assertQueue(
        `${AI_QUALITY_QUEUE}.retry.${index + 1}`,
        {
          durable: true,
          arguments: {
            "x-message-ttl": delay,
            "x-dead-letter-exchange": EVENTS_EXCHANGE,
            "x-dead-letter-routing-key": AI_QUALITY_ROUTING_KEY,
          },
        },
      );
    }
    await this.channel.prefetch(concurrency);
    await this.channel.consume(AI_QUALITY_QUEUE, (message) => {
      if (message) void this.handle(message);
    });
  }

  async close(): Promise<void> {
    if (this.channel) await this.channel.close().catch(() => undefined);
    if (this.connection) await this.connection.close().catch(() => undefined);
    this.channel = null;
    this.connection = null;
  }

  private async handle(message: ConsumeMessage): Promise<void> {
    const channel = this.channel;
    if (!channel) return;
    const retryAttempt = Number(
      message.properties.headers?.["retry-attempt"] ?? 0,
    );
    let submissionId: string | null = null;
    try {
      const payload = JSON.parse(message.content.toString("utf8")) as {
        submissionId?: unknown;
      };
      if (typeof payload.submissionId !== "string") {
        throw new Error("AI quality job submissionId is invalid");
      }
      submissionId = payload.submissionId;
      await this.analysis.process({ submissionId });
      channel.ack(message);
    } catch (error) {
      if (
        error instanceof RetryableAiQualityError &&
        retryAttempt < RETRY_DELAYS.length
      ) {
        channel.sendToQueue(
          `${AI_QUALITY_QUEUE}.retry.${retryAttempt + 1}`,
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
      } else if (submissionId && error instanceof RetryableAiQualityError) {
        await this.analysis.markTerminalFailure(submissionId, error);
      }
      channel.ack(message);
    }
  }
}
