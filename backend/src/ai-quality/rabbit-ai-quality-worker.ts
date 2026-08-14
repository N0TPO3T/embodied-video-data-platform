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
import { WorkerHeartbeatService } from "../operations/worker-heartbeat.service.js";
import {
  AiQualityAnalysisService,
  RetryableAiQualityError,
  TerminalAiQualityError,
  type AiQualityProcessOutcome,
} from "./ai-quality-analysis.service.js";
import { aiQualityModelTimeoutMs } from "./ai-quality.config.js";

const RETRY_DELAYS = [5_000, 30_000, 120_000] as const;
const HEARTBEAT_INTERVAL_MS = 15_000;

type RabbitConnector = typeof connect;
class AiQualityLockBusyError extends RetryableAiQualityError {}
class AiQualityTimeoutError extends RetryableAiQualityError {}

type HeartbeatState = {
  status: "idle" | "running";
  currentSubmissionId: string | null;
  currentTaskStartedAt: Date | null;
  lastError: string | null;
};

@Injectable()
export class RabbitAiQualityWorker {
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
  private readonly taskTimeoutMs = aiQualityModelTimeoutMs(
    process.env.AI_QUALITY_MODEL_TIMEOUT_MS,
  );

  constructor(
    private readonly analysis: AiQualityAnalysisService,
    private readonly heartbeats?: WorkerHeartbeatService,
  ) {}

  async start(
    url: string,
    concurrency: number,
    connector: RabbitConnector = connect,
  ): Promise<void> {
    await this.bestEffortHeartbeat(() => this.startHeartbeat());
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
    this.stopHeartbeatTimer();
    if (this.heartbeatId) {
      await this.heartbeats?.stop(this.heartbeatId).catch(() => undefined);
    }
    if (this.channel) await this.channel.close().catch(() => undefined);
    if (this.connection) await this.connection.close().catch(() => undefined);
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
          throw new Error("AI quality job submissionId is invalid");
        }
        submissionId = payload.submissionId;
        await this.bestEffortHeartbeat(() =>
          this.markTaskStarted(submissionId!),
        );
        const outcome = await this.processWithTimeout(
          submissionId,
          retryAttempt >= RETRY_DELAYS.length,
        );
        if (outcome === "lock_busy") {
          throw new AiQualityLockBusyError("同一视频的 AI 质检任务仍在运行");
        }
      } catch (error) {
        taskError =
          error instanceof Error
            ? error.message.slice(0, 1_000)
            : "AI 质检失败";
        const lockBusy = error instanceof AiQualityLockBusyError;
        const infrastructureFailure =
          submissionId !== null &&
          !(error instanceof TerminalAiQualityError) &&
          !(error instanceof RetryableAiQualityError);
        const retryUntilRecovered =
          lockBusy ||
          error instanceof AiQualityTimeoutError ||
          infrastructureFailure;
        const retryQueueNumber = retryUntilRecovered
          ? Math.min(retryAttempt + 1, RETRY_DELAYS.length)
          : error instanceof RetryableAiQualityError &&
              retryAttempt < RETRY_DELAYS.length
            ? retryAttempt + 1
            : null;
        if (retryQueueNumber !== null) {
          channel.sendToQueue(
            `${AI_QUALITY_QUEUE}.retry.${retryQueueNumber}`,
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

  private async processWithTimeout(
    submissionId: string,
    terminalOnRetryableFailure: boolean,
  ): Promise<AiQualityProcessOutcome> {
    const controller = new AbortController();
    const timeoutError = new AiQualityTimeoutError(
      `AI 质检任务超过 ${Math.round(this.taskTimeoutMs / 60_000)} 分钟未完成，已自动切换下一条任务`,
    );
    let rejectTimeout: (error: Error) => void = () => undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort(timeoutError);
      rejectTimeout(timeoutError);
    }, this.taskTimeoutMs);
    if (typeof timeout.unref === "function") timeout.unref();
    try {
      return await Promise.race([
        this.analysis.process({
          submissionId,
          signal: controller.signal,
          terminalOnRetryableFailure,
        }),
        timedOut,
      ]);
    } finally {
      clearTimeout(timeout);
    }
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
    this.heartbeatId = await this.heartbeats.start("ai_quality");
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
