import { Injectable, Optional } from "@nestjs/common";
import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";

import {
  MediaAnalysisService,
  RetryableMediaError,
  TerminalMediaError,
  type MediaProcessOutcome,
} from "./media-analysis.service.js";
import {
  assertMediaTopology,
  assertSubmissionSourceRetentionTopology,
  assertTaskSegmentTopology,
  EVENTS_EXCHANGE,
  MEDIA_QUEUE,
  SUBMISSION_SOURCE_RETENTION_QUEUE,
  SUBMISSION_SOURCE_RETENTION_ROUTING_KEY,
  TASK_SEGMENT_QUEUE,
  TASK_SEGMENT_ROUTING_KEY,
} from "../messaging/rabbitmq-topology.js";
import { WorkerHeartbeatService } from "../operations/worker-heartbeat.service.js";
import {
  RetryableTaskSegmentError,
  TaskSegmentProcessor,
} from "../task-segment/task-segment.processor.js";
import {
  RetryableSourceRetentionError,
  SourceRetentionProcessor,
} from "../task-segment/source-retention.processor.js";

const RETRY_DELAYS = [5_000, 30_000, 120_000] as const;
const HEARTBEAT_INTERVAL_MS = 15_000;

type RabbitConnector = typeof connect;
class MediaLockBusyError extends RetryableMediaError {}

function errorMessage(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : fallback).slice(0, 1_000);
}

type HeartbeatState = {
  status: "idle" | "running";
  currentSubmissionId: string | null;
  currentTaskStartedAt: Date | null;
  lastError: string | null;
};

@Injectable()
export class RabbitMediaWorker {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private heartbeatId: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatState: HeartbeatState = {
    status: "idle",
    currentSubmissionId: null,
    currentTaskStartedAt: null,
    lastError: null,
  };
  private readonly activeSubmissions = new Map<string, Date>();

  constructor(
    private readonly analysis: MediaAnalysisService,
    private readonly heartbeats?: WorkerHeartbeatService,
    @Optional() private readonly taskSegments?: TaskSegmentProcessor,
    @Optional() private readonly sourceRetention?: SourceRetentionProcessor,
  ) {}

  async start(
    url: string,
    connector: RabbitConnector = connect,
  ): Promise<void> {
    await this.bestEffortHeartbeat(() => this.startHeartbeat());
    this.connection = await connector(url);
    this.channel = await this.connection.createConfirmChannel();
    await assertMediaTopology(this.channel);
    await assertTaskSegmentTopology(this.channel);
    await assertSubmissionSourceRetentionTopology(this.channel);
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
    for (const [index, delay] of RETRY_DELAYS.entries()) {
      await this.channel.assertQueue(`${TASK_SEGMENT_QUEUE}.retry.${index + 1}`, {
        durable: true,
        arguments: {
          "x-message-ttl": delay,
          "x-dead-letter-exchange": EVENTS_EXCHANGE,
          "x-dead-letter-routing-key": TASK_SEGMENT_ROUTING_KEY,
        },
      });
    }
    for (const [index, delay] of RETRY_DELAYS.entries()) {
      await this.channel.assertQueue(`${SUBMISSION_SOURCE_RETENTION_QUEUE}.retry.${index + 1}`, {
        durable: true,
        arguments: {
          "x-message-ttl": delay,
          "x-dead-letter-exchange": EVENTS_EXCHANGE,
          "x-dead-letter-routing-key": SUBMISSION_SOURCE_RETENTION_ROUTING_KEY,
        },
      });
    }
    await this.channel.prefetch(1);
    if (this.taskSegments) {
      await this.channel.consume(TASK_SEGMENT_QUEUE, (message) => {
        if (message) void this.handleTaskSegment(message);
      });
    }
    if (this.sourceRetention) {
      await this.channel.consume(SUBMISSION_SOURCE_RETENTION_QUEUE, (message) => {
        if (message) void this.handleSourceRetention(message);
      });
    }
    await this.channel.consume(MEDIA_QUEUE, (message) => {
      if (message) void this.handle(message);
    });
  }

  private async handleTaskSegment(message: ConsumeMessage): Promise<void> {
    const channel = this.channel;
    if (!channel || !this.taskSegments) return;
    const retryAttempt = Number(
      message.properties.headers?.["retry-attempt"] ?? 0,
    );
    let submissionId: string | null = null;
    let taskError: string | null = null;
    try {
      try {
        const payload = JSON.parse(message.content.toString("utf8")) as {
          assetId?: unknown;
          submissionId?: unknown;
        };
        if (
          typeof payload.assetId !== "string" ||
          typeof payload.submissionId !== "string"
        ) {
          throw new Error("task segment job payload is invalid");
        }
        submissionId = payload.submissionId;
        await this.bestEffortHeartbeat(() => this.markTaskStarted(submissionId!));
        await this.taskSegments.process({
          assetId: payload.assetId,
          recoverProcessing: retryAttempt > 0 || message.fields.redelivered,
        });
      } catch (error) {
        taskError = errorMessage(error, "任务片段生成失败");
        const retryable =
          error instanceof RetryableTaskSegmentError ||
          (submissionId !== null && !(error instanceof Error && error.message === "task segment job payload is invalid"));
        if (retryable && retryAttempt < RETRY_DELAYS.length) {
          const retryQueueNumber = retryAttempt + 1;
          channel.sendToQueue(
            `${TASK_SEGMENT_QUEUE}.retry.${retryQueueNumber}`,
            message.content,
            {
              ...message.properties,
              headers: {
                ...message.properties.headers,
                "retry-attempt": retryQueueNumber,
              },
              persistent: true,
            },
          );
          await channel.waitForConfirms();
        }
      }
    } finally {
      if (submissionId) {
        await this.bestEffortHeartbeat(() =>
          this.markTaskFinished(submissionId!, taskError),
        );
      } else if (taskError) {
        await this.bestEffortHeartbeat(() =>
          this.setHeartbeatState("idle", null, null, taskError),
        );
      }
      channel.ack(message);
    }
  }

  private async handleSourceRetention(message: ConsumeMessage): Promise<void> {
    const channel = this.channel;
    if (!channel || !this.sourceRetention) return;
    const retryAttempt = Number(
      message.properties.headers?.["retry-attempt"] ?? 0,
    );
    try {
      const payload = JSON.parse(message.content.toString("utf8")) as {
        submissionId?: unknown;
        reason?: unknown;
      };
      if (typeof payload.submissionId !== "string") {
        throw new Error("source retention job payload is invalid");
      }
      await this.sourceRetention.process({
        submissionId: payload.submissionId,
        reason: typeof payload.reason === "string" ? payload.reason : "settlement",
      });
    } catch (error) {
      const retryable =
        error instanceof RetryableSourceRetentionError &&
        retryAttempt < RETRY_DELAYS.length;
      if (retryable) {
        const retryQueueNumber = retryAttempt + 1;
        channel.sendToQueue(
          `${SUBMISSION_SOURCE_RETENTION_QUEUE}.retry.${retryQueueNumber}`,
          message.content,
          {
            ...message.properties,
            headers: {
              ...message.properties.headers,
              "retry-attempt": retryQueueNumber,
            },
            persistent: true,
          },
        );
        await channel.waitForConfirms();
      }
    } finally {
      channel.ack(message);
    }
  }

  async close(): Promise<void> {
    this.stopHeartbeatTimer();
    if (this.heartbeatId) {
      await this.heartbeats?.stop(this.heartbeatId).catch(() => undefined);
    }
    if (this.channel) await this.channel.close().catch(() => undefined);
    if (this.connection) {
      await this.connection.close().catch(() => undefined);
    }
    this.channel = null;
    this.connection = null;
    this.heartbeatId = null;
  }

  private async handle(message: ConsumeMessage): Promise<void> {
    const channel = this.channel;
    if (!channel) return;
    const retryAttempt = Number(
      message.properties.headers?.["retry-attempt"] ?? 0,
    );
    let submissionId: string | null = null;
    let taskError: string | null = null;
    try {
      try {
        const payload = JSON.parse(message.content.toString("utf8")) as {
          submissionId?: unknown;
        };
        if (typeof payload.submissionId !== "string") {
          throw new Error("media job submissionId is invalid");
        }
        submissionId = payload.submissionId;
        await this.bestEffortHeartbeat(() =>
          this.markTaskStarted(submissionId!),
        );
        const outcome: MediaProcessOutcome = await this.analysis.process({
          submissionId,
        });
        if (outcome === "lock_busy") {
          throw new MediaLockBusyError("同一视频的媒体任务仍在运行");
        }
      } catch (error) {
        taskError =
          error instanceof Error
            ? error.message.slice(0, 1_000)
            : "媒体任务失败";
        const lockBusy = error instanceof MediaLockBusyError;
        const infrastructureFailure =
          submissionId !== null &&
          !(error instanceof TerminalMediaError) &&
          !(error instanceof RetryableMediaError);
        const retryQueueNumber = lockBusy || infrastructureFailure
          ? Math.min(retryAttempt + 1, RETRY_DELAYS.length)
          : error instanceof RetryableMediaError &&
              retryAttempt < RETRY_DELAYS.length
            ? retryAttempt + 1
            : null;
        if (retryQueueNumber !== null) {
          channel.sendToQueue(
            `${MEDIA_QUEUE}.retry.${retryQueueNumber}`,
            message.content,
            {
              ...message.properties,
              headers: {
                ...message.properties.headers,
                "retry-attempt": retryQueueNumber,
              },
              persistent: true,
            },
          );
          await channel.waitForConfirms();
        }
      }
    } finally {
      if (submissionId) {
        await this.bestEffortHeartbeat(() =>
          this.markTaskFinished(submissionId!, taskError),
        );
      } else if (taskError) {
        await this.bestEffortHeartbeat(() =>
          this.setHeartbeatState("idle", null, null, taskError),
        );
      }
    }
    channel.ack(message);
  }

  private async bestEffortHeartbeat(
    operation: () => Promise<void>,
  ): Promise<void> {
    await operation().catch(() => undefined);
  }

  private async markTaskStarted(submissionId: string): Promise<void> {
    this.activeSubmissions.set(submissionId, new Date());
    await this.publishHeartbeatState();
  }

  private async markTaskFinished(
    submissionId: string,
    lastError: string | null = null,
  ): Promise<void> {
    const startedAt = this.activeSubmissions.get(submissionId);
    try {
      if (this.heartbeatId && startedAt) {
        await this.heartbeats?.recordTaskFinished({
          id: this.heartbeatId,
          durationMs: Date.now() - startedAt.getTime(),
          failed: lastError !== null,
        });
      }
    } finally {
      this.activeSubmissions.delete(submissionId);
      await this.publishHeartbeatState(lastError);
    }
  }

  private async publishHeartbeatState(
    lastError: string | null = null,
  ): Promise<void> {
    const currentEntry = this.activeSubmissions.entries().next().value;
    const currentSubmissionId = currentEntry?.[0] ?? null;
    const currentTaskStartedAt = currentEntry?.[1] ?? null;
    await this.setHeartbeatState(
      currentSubmissionId ? "running" : "idle",
      currentSubmissionId,
      currentTaskStartedAt,
      lastError,
    );
  }

  private async startHeartbeat(): Promise<void> {
    if (!this.heartbeats) return;
    this.heartbeatId = await this.heartbeats.start("media");
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatId && this.heartbeats) {
        const state = this.heartbeatState;
        void this.heartbeats
          .beat(this.heartbeatId, state)
          .catch(() => undefined);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async setHeartbeatState(
    status: "idle" | "running",
    submissionId: string | null,
    currentTaskStartedAt: Date | null,
    lastError: string | null = null,
  ): Promise<void> {
    this.heartbeatState = {
      status,
      currentSubmissionId: submissionId,
      currentTaskStartedAt,
      lastError,
    };
    if (this.heartbeatId) {
      await this.heartbeats?.beat(this.heartbeatId, {
        status,
        currentSubmissionId: submissionId,
        currentTaskStartedAt,
        lastError,
      });
    }
  }

  private stopHeartbeatTimer(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
