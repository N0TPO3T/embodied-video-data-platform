import { extname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { Inject, Injectable } from "@nestjs/common";
import { DataSource, type QueryRunner } from "typeorm";

import { LabelSetService } from "../ai-quality/label-set.service.js";
import {
  aiAnnotationModelTimeoutMs,
  videoAnnotationPromptPath,
} from "../ai-quality/ai-quality.config.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { labelSetSnapshot } from "../rules/rule-calculator.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import { VideoQualityMediaPreprocessor } from "../video-quality/media-preprocessor.js";
import { loadVideoAnnotationPrompt } from "./prompt-loader.js";
import {
  QwenVideoAnnotationProvider,
  VideoAnnotationProviderError,
} from "./qwen-video-annotation.provider.js";

export type AnnotationRunProcessOutcome = "processed" | "skipped" | "lock_busy";

export class TerminalAnnotationRunError extends Error {}
export class RetryableAnnotationRunError extends Error {}

type PostgresSessionQueryRunner = QueryRunner & {
  releasePostgresConnection(error?: Error): Promise<void>;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TerminalAnnotationRunError(`${name} is required`);
  return value;
}

function safeError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
    .replace(/sk-(?:ws-)?[A-Za-z0-9._-]+/gu, "<redacted>")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gu, "<data-url-redacted>")
    .slice(0, 1_500);
}

function errorCode(error: unknown): string {
  if (error instanceof VideoAnnotationProviderError) {
    return error.status === null ? "MODEL_RESPONSE_INVALID" : `MODEL_HTTP_${error.status}`;
  }
  if (error instanceof TerminalAnnotationRunError) return "ANNOTATION_TERMINAL";
  return "ANNOTATION_INFRASTRUCTURE";
}

function classify(error: unknown): TerminalAnnotationRunError | RetryableAnnotationRunError {
  if (error instanceof TerminalAnnotationRunError || error instanceof RetryableAnnotationRunError) {
    return error;
  }
  if (error instanceof VideoAnnotationProviderError) {
    if (error.status === 408 || error.status === 429 || (error.status ?? 0) >= 500) {
      return new RetryableAnnotationRunError(safeError(error));
    }
    return new TerminalAnnotationRunError(safeError(error));
  }
  return new RetryableAnnotationRunError(safeError(error));
}

async function releaseAnnotationLock(
  queryRunner: QueryRunner,
  runId: string,
): Promise<void> {
  try {
    const rows = (await queryRunner.query(
      "SELECT pg_advisory_unlock(hashtextextended('annotation:' || $1, 0)) AS unlocked",
      [runId],
    )) as Array<{ unlocked: boolean }>;
    if (rows[0]?.unlocked !== true) {
      throw new Error("Annotation advisory lock was not held by this session");
    }
  } catch (error) {
    await (queryRunner as PostgresSessionQueryRunner).releasePostgresConnection(
      error instanceof Error ? error : new Error("Annotation advisory unlock failed"),
    );
    return;
  }
  await queryRunner.release();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

@Injectable()
export class AnnotationRunService {
  private readonly preprocessor = new VideoQualityMediaPreprocessor();

  constructor(
    private readonly dataSource: DataSource,
    private readonly labelSets: LabelSetService,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
  ) {}

  async process(input: {
    runId: string;
    signal?: AbortSignal;
    terminalOnRetryableFailure?: boolean;
    retryDelayMs?: number;
  }): Promise<AnnotationRunProcessOutcome> {
    const lockRunner = this.dataSource.createQueryRunner();
    await lockRunner.connect();
    let acquired = false;
    try {
      const rows = (await lockRunner.query(
        "SELECT pg_try_advisory_lock(hashtextextended('annotation:' || $1, 0)) AS acquired",
        [input.runId],
      )) as Array<{ acquired: boolean }>;
      acquired = rows[0]?.acquired === true;
      if (!acquired) return "lock_busy";

      let directory: string | null = null;
      try {
        const task = await this.begin(input.runId);
        if (!task) return "skipped";
        directory = await mkdtemp(join(tmpdir(), "evdp-annotation-"));
        const mediaPath = join(
          directory,
          `original${extname(task.submission.originalFileName).toLowerCase()}`,
        );
        await this.storage.downloadObject({
          objectKey: task.submission.objectKey,
          destinationPath: mediaPath,
        });
        if (input.signal?.aborted) throw input.signal.reason;
        const evidence = await this.preprocessor.prepareAnnotation(
          mediaPath,
          join(directory, "evidence"),
          input.signal,
        );
        if (evidence.sha256 !== task.submission.checksumSha256) {
          throw new TerminalAnnotationRunError("候选标注视频 SHA-256 校验失败");
        }
        const prompt = {
          systemPrompt: task.run.systemPromptSnapshot!,
          outputExample: task.run.outputExampleSnapshot!,
          promptVersion: task.run.promptVersion!,
          outputSchema: task.run.schemaVersion as "ego_video_annotation_v2",
          model: task.run.model!,
          contentSha256: task.run.promptContentSha256!,
        };
        const provider = new QwenVideoAnnotationProvider({
          apiKey: required("QWEN_API_KEY"),
          baseUrl: required("QWEN_BASE_URL"),
          timeoutMs: aiAnnotationModelTimeoutMs(
            process.env.AI_ANNOTATION_MODEL_TIMEOUT_MS,
          ),
          prompt,
        });
        const enabledLabels = (task.run.labelSetSnapshot?.labels ?? []).flatMap(
          (label) =>
            label.enabled &&
            (label.type === "scene" || label.type === "action" || label.type === "object")
              ? [{ id: label.id, name: label.name, type: label.type }]
              : [],
        );
        const result = await provider.annotateStrict(
          {
            videoId: task.submission.id,
            durationMs: evidence.metadata.duration_ms,
            frames: evidence.fullVideoFrames,
            enabledLabels,
          },
          input.signal,
        );
        await this.complete(task.run.id, result);
        return "processed";
      } catch (error) {
        const classified = classify(error);
        await this.fail(input.runId, error, {
          terminal:
            classified instanceof TerminalAnnotationRunError ||
            input.terminalOnRetryableFailure === true,
          retryDelayMs: input.retryDelayMs ?? 0,
        });
        throw classified;
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    } finally {
      if (acquired) await releaseAnnotationLock(lockRunner, input.runId);
      else await lockRunner.release();
    }
  }

  private async begin(runId: string): Promise<{
    run: AnnotationRunEntity;
    submission: SubmissionEntity;
  } | null> {
    const existing = await this.dataSource.getRepository(AnnotationRunEntity).findOneBy({
      id: runId,
    });
    if (!existing) throw new TerminalAnnotationRunError("候选标注运行不存在");
    if (["succeeded", "system_failed", "cancelled"].includes(existing.executionStatus)) {
      return null;
    }
    if (!["queued", "retry_scheduled", "stuck"].includes(existing.executionStatus)) {
      return null;
    }
    const prompt = existing.systemPromptSnapshot
      ? null
      : await loadVideoAnnotationPrompt(videoAnnotationPromptPath());
    const activeLabels = existing.labelSetSnapshot
      ? null
      : await this.labelSets.getActiveLabelSetForWorker();

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AnnotationRunEntity);
      const run = await repository.findOne({
        where: { id: runId },
        lock: { mode: "pessimistic_write" },
      });
      if (!run) throw new TerminalAnnotationRunError("候选标注运行不存在");
      if (!["queued", "retry_scheduled", "stuck"].includes(run.executionStatus)) {
        return null;
      }
      const submission = await manager.getRepository(SubmissionEntity).findOneBy({
        id: run.submissionId,
      });
      if (!submission) throw new TerminalAnnotationRunError("视频提交不存在");
      if (submission.uploadStatus !== "uploaded") {
        throw new TerminalAnnotationRunError("视频对象尚未完成上传");
      }
      if (submission.storageStatus !== "available") {
        throw new TerminalAnnotationRunError("视频源文件当前不可用于标注");
      }
      const metadata = await manager.getRepository(MediaMetadataEntity).findOneBy({
        submissionId: submission.id,
      });
      if (!metadata) throw new TerminalAnnotationRunError("视频媒体元数据尚未生成");
      if (!run.systemPromptSnapshot) {
        if (!prompt || !activeLabels) {
          throw new TerminalAnnotationRunError("候选标注配置快照不可用");
        }
        const labels = labelSetSnapshot(activeLabels);
        run.promptVersion = prompt.promptVersion;
        run.promptContentSha256 = prompt.contentSha256;
        run.systemPromptSnapshot = prompt.systemPrompt;
        run.outputExampleSnapshot = prompt.outputExample;
        run.model = prompt.model;
        run.labelSetVersionId = labels.id;
        run.labelSetRevision = labels.revision;
        run.labelSetSnapshot = labels;
      }
      run.executionStatus = "running";
      run.attemptCount += 1;
      run.startedAt = new Date();
      run.nextRetryAt = null;
      run.lastErrorCode = null;
      run.lastErrorMessage = null;
      return { run: await repository.save(run), submission };
    });
  }

  private async complete(
    runId: string,
    result: Awaited<ReturnType<QwenVideoAnnotationProvider["annotateStrict"]>>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AnnotationRunEntity);
      const run = await repository.findOne({
        where: { id: runId },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !run ||
        !["queued", "retry_scheduled", "stuck", "running"].includes(run.executionStatus)
      ) return;
      run.executionStatus = "succeeded";
      run.reviewStatus = "pending";
      run.publicationStatus = "candidate_only";
      run.providerRequestId = result.requestId;
      run.responseModel = result.responseModel ?? null;
      run.rawResult = jsonRecord(result.raw);
      run.normalizedResult = jsonRecord(result);
      run.inputTokens = result.usage?.promptTokens ?? null;
      run.outputTokens = result.usage?.completionTokens ?? null;
      run.totalTokens = result.usage?.totalTokens ?? null;
      run.latencyMs = result.durationMs;
      run.frameCount = result.frameCount;
      run.sourceTimestampsMs = result.sampling.sourceTimestampsMs;
      run.completedAt = new Date();
      run.lastErrorCode = null;
      run.lastErrorMessage = null;
      await repository.save(run);
    });
  }

  private async fail(
    runId: string,
    error: unknown,
    input: { terminal: boolean; retryDelayMs: number },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AnnotationRunEntity);
      const run = await repository.findOne({
        where: { id: runId },
        lock: { mode: "pessimistic_write" },
      });
      if (!run || run.executionStatus !== "running") return;
      run.executionStatus = input.terminal ? "system_failed" : "retry_scheduled";
      run.lastErrorCode = errorCode(error);
      run.lastErrorMessage = safeError(error);
      run.nextRetryAt = input.terminal
        ? null
        : new Date(Date.now() + Math.max(0, input.retryDelayMs));
      if (input.terminal) run.completedAt = new Date();
      await repository.save(run);
    });
  }
}
