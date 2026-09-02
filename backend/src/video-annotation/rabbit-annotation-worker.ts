import { Injectable } from "@nestjs/common";
import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";

import {
  AI_ANNOTATION_QUEUE,
  AI_ANNOTATION_ROUTING_KEY,
  EVENTS_EXCHANGE,
  TASK_BOUNDARY_REFINEMENT_QUEUE,
  TASK_BOUNDARY_REFINEMENT_ROUTING_KEY,
  assertAiAnnotationTopology,
  assertTaskBoundaryRefinementTopology,
} from "../messaging/rabbitmq-topology.js";
import { WorkerHeartbeatService } from "../operations/worker-heartbeat.service.js";
import { aiAnnotationModelTimeoutMs } from "../ai-quality/ai-quality.config.js";
import {
  AnnotationRunService,
  RetryableAnnotationRunError,
} from "./annotation-run.service.js";
import { TaskBoundaryRefinementProcessor } from "../task-segment/task-boundary-refinement.processor.js";

const RETRY_DELAYS = [5_000, 30_000, 120_000] as const;
const HEARTBEAT_INTERVAL_MS = 15_000;
type RabbitConnector = typeof connect;

@Injectable()
export class RabbitAnnotationWorker {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private heartbeatId: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly activeRuns = new Map<string, Date>();
  private readonly taskTimeoutMs = aiAnnotationModelTimeoutMs(
    process.env.AI_ANNOTATION_MODEL_TIMEOUT_MS,
  );

  constructor(
    private readonly runs: AnnotationRunService,
    private readonly boundaryRefinements: TaskBoundaryRefinementProcessor,
    private readonly heartbeats?: WorkerHeartbeatService,
  ) {}

  async start(
    url: string,
    concurrency: number,
    connector: RabbitConnector = connect,
  ): Promise<void> {
    await this.bestEffort(() => this.startHeartbeat());
    this.connection = await connector(url);
    this.channel = await this.connection.createConfirmChannel();
    await assertAiAnnotationTopology(this.channel);
    await assertTaskBoundaryRefinementTopology(this.channel);
    for (const [index, delay] of RETRY_DELAYS.entries()) {
      await this.channel.assertQueue(`${AI_ANNOTATION_QUEUE}.retry.${index + 1}`, {
        durable: true,
        arguments: {
          "x-message-ttl": delay,
          "x-dead-letter-exchange": EVENTS_EXCHANGE,
          "x-dead-letter-routing-key": AI_ANNOTATION_ROUTING_KEY,
        },
      });
    }
    for (const [index, delay] of RETRY_DELAYS.entries()) {
      await this.channel.assertQueue(
        `${TASK_BOUNDARY_REFINEMENT_QUEUE}.retry.${index + 1}`,
        {
          durable: true,
          arguments: {
            "x-message-ttl": delay,
            "x-dead-letter-exchange": EVENTS_EXCHANGE,
            "x-dead-letter-routing-key": TASK_BOUNDARY_REFINEMENT_ROUTING_KEY,
          },
        },
      );
    }
    await this.channel.prefetch(concurrency);
    await this.channel.consume(AI_ANNOTATION_QUEUE, (message) => {
      if (message) void this.handle(message);
    });
    await this.channel.consume(TASK_BOUNDARY_REFINEMENT_QUEUE, (message) => {
      if (message) void this.handleBoundaryRefinement(message);
    });
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
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
    const retryAttempt = Number(message.properties.headers?.["retry-attempt"] ?? 0);
    let runId: string | null = null;
    let taskError: string | null = null;
    let deadLetter = false;
    try {
      const payload = JSON.parse(message.content.toString("utf8")) as {
        runId?: unknown;
      };
      if (typeof payload.runId !== "string") {
        throw new Error("Annotation job runId is invalid");
      }
      runId = payload.runId;
      this.activeRuns.set(runId, new Date());
      await this.publishHeartbeat();
      try {
        const outcome = await this.processWithTimeout(
          runId,
          retryAttempt >= RETRY_DELAYS.length,
          RETRY_DELAYS[retryAttempt] ?? 0,
        );
        if (outcome === "lock_busy") return;
      } catch (error) {
        taskError = error instanceof Error ? error.message.slice(0, 1_000) : "候选标注失败";
        if (
          error instanceof RetryableAnnotationRunError &&
          retryAttempt < RETRY_DELAYS.length
        ) {
          const retryQueueNumber = retryAttempt + 1;
          channel.sendToQueue(
            `${AI_ANNOTATION_QUEUE}.retry.${retryQueueNumber}`,
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
        } else {
          deadLetter = true;
        }
      }
    } catch (error) {
      taskError = error instanceof Error ? error.message.slice(0, 1_000) : "候选标注消息无效";
      deadLetter = true;
    } finally {
      if (runId) {
        const startedAt = this.activeRuns.get(runId);
        if (this.heartbeatId && startedAt) {
          await this.bestEffort(() =>
            this.heartbeats!.recordTaskFinished({
              id: this.heartbeatId!,
              durationMs: Date.now() - startedAt.getTime(),
              failed: taskError !== null,
            }),
          );
        }
        this.activeRuns.delete(runId);
        await this.publishHeartbeat(taskError);
      }
      if (deadLetter) channel.reject(message, false);
      else channel.ack(message);
    }
  }

  private async processWithTimeout(
    runId: string,
    terminalOnRetryableFailure: boolean,
    retryDelayMs: number,
  ) {
    const controller = new AbortController();
    const timeoutError = new RetryableAnnotationRunError(
      `候选标注任务超过 ${Math.round(this.taskTimeoutMs / 60_000)} 分钟未完成`,
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
        this.runs.process({
          runId,
          signal: controller.signal,
          terminalOnRetryableFailure,
          retryDelayMs,
        }),
        timedOut,
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async handleBoundaryRefinement(message: ConsumeMessage): Promise<void> {
    const channel = this.channel;
    if (!channel) return;
    const retryAttempt = Number(message.properties.headers?.["retry-attempt"] ?? 0);
    let refinementId: string | null = null;
    let taskError: string | null = null;
    let deadLetter = false;
    try {
      const payload = JSON.parse(message.content.toString("utf8")) as {
        refinementId?: unknown;
      };
      if (typeof payload.refinementId !== "string") {
        throw new Error("Boundary refinement job refinementId is invalid");
      }
      refinementId = payload.refinementId;
      this.activeRuns.set(refinementId, new Date());
      await this.publishHeartbeat();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(new Error("边界精修任务超时")),
          this.taskTimeoutMs,
        );
        if (typeof timeout.unref === "function") timeout.unref();
        try {
          await this.boundaryRefinements.process({
            refinementId,
            recoverRunning: retryAttempt > 0 || message.fields.redelivered,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        taskError = error instanceof Error ? error.message.slice(0, 1_000) : "边界精修失败";
        if (retryAttempt < RETRY_DELAYS.length) {
          const retryQueueNumber = retryAttempt + 1;
          channel.sendToQueue(
            `${TASK_BOUNDARY_REFINEMENT_QUEUE}.retry.${retryQueueNumber}`,
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
        } else {
          await this.boundaryRefinements.forceSystemFailed(refinementId, error);
          deadLetter = true;
        }
      }
    } catch (error) {
      taskError = error instanceof Error ? error.message.slice(0, 1_000) : "边界精修消息无效";
      deadLetter = true;
    } finally {
      if (refinementId) {
        const startedAt = this.activeRuns.get(refinementId);
        if (this.heartbeatId && startedAt) {
          await this.bestEffort(() =>
            this.heartbeats!.recordTaskFinished({
              id: this.heartbeatId!,
              durationMs: Date.now() - startedAt.getTime(),
              failed: taskError !== null,
            }),
          );
        }
        this.activeRuns.delete(refinementId);
        await this.publishHeartbeat(taskError);
      }
      if (deadLetter) channel.reject(message, false);
      else channel.ack(message);
    }
  }

  private async startHeartbeat(): Promise<void> {
    if (!this.heartbeats) return;
    this.heartbeatId = await this.heartbeats.start("ai_annotation");
    this.heartbeatTimer = setInterval(() => {
      void this.publishHeartbeat().catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    if (typeof this.heartbeatTimer.unref === "function") this.heartbeatTimer.unref();
    await this.publishHeartbeat();
  }

  private async publishHeartbeat(lastError: string | null = null): Promise<void> {
    if (!this.heartbeatId || !this.heartbeats) return;
    const current = this.activeRuns.entries().next().value as
      | [string, Date]
      | undefined;
    await this.bestEffort(() =>
      this.heartbeats!.beat(this.heartbeatId!, {
        status: current ? "running" : "idle",
        currentSubmissionId: current?.[0] ?? null,
        currentTaskStartedAt: current?.[1] ?? null,
        lastError,
      }),
    );
  }

  private async bestEffort(operation: () => Promise<void>): Promise<void> {
    await operation().catch(() => undefined);
  }
}
