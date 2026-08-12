import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import {
  VideoQualityResultEntity,
  type VideoQualityResultStatus,
} from "../database/entities/video-quality-result.entity.js";
import type { VideoQualityPromptVersionEntity } from "../database/entities/video-quality-prompt-version.entity.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import { BailianRequestError } from "../video-quality/qwen-video-quality.provider.js";
import { loadVideoQualityPrompt } from "../video-quality/prompt-loader.js";
import type { NormalizedVideoQcResultV1 } from "../video-quality/video-quality.types.js";
import { videoQualityPromptPath } from "./ai-quality.config.js";
import { AiQualityPromptService } from "./ai-quality-prompt.service.js";
import {
  AI_QUALITY_EVALUATOR_FACTORY,
  type AiQualityEvaluatorFactory,
} from "./ai-quality.tokens.js";

const TERMINAL_RESULT_STATUSES = new Set<VideoQualityResultStatus>([
  "scored",
  "hard_reject",
  "review_pending",
]);

export class TerminalAiQualityError extends Error {}

export class RetryableAiQualityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export type AiQualityProcessOutcome = "processed" | "skipped";

function resultStatus(
  result: NormalizedVideoQcResultV1,
): VideoQualityResultStatus {
  if (result.evaluationStatus === "hard_reject") return "hard_reject";
  if (
    result.evaluationStatus === "review_pending" ||
    result.evaluationStatus === "incomplete_input"
  ) {
    return "review_pending";
  }
  if (result.evaluationStatus === "scored") return "scored";
  throw new TerminalAiQualityError("AI 质检返回了不可持久化的失败状态");
}

function compactError(error: unknown): string {
  return (error instanceof Error ? error.message : "AI 质检失败")
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
    .replace(/sk-(?:ws-)?[A-Za-z0-9._-]+/gu, "<redacted>")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gu, "<data-url-redacted>")
    .slice(0, 2_000);
}

function classify(error: unknown): Error {
  if (error instanceof TerminalAiQualityError) return error;
  if (error instanceof BailianRequestError) {
    const retryable =
      error.status === null ||
      [408, 409, 425, 429].includes(error.status) ||
      error.status >= 500;
    return retryable
      ? new RetryableAiQualityError(compactError(error), { cause: error })
      : new TerminalAiQualityError(compactError(error), { cause: error });
  }
  const message = compactError(error);
  if (/FFprobe|FFmpeg|视频取样少于/u.test(message)) {
    return new TerminalAiQualityError(message, { cause: error });
  }
  if (
    /质检提示词|系统提示词|当前 AI 质检提示词|初始化 AI 质检/u.test(
      message,
    )
  ) {
    return new TerminalAiQualityError(message, { cause: error });
  }
  return new RetryableAiQualityError(message, { cause: error });
}

function decimal(value: number | null, digits: number): string | null {
  return value === null ? null : value.toFixed(digits);
}

@Injectable()
export class AiQualityAnalysisService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SubmissionEntity)
    private readonly submissions: Repository<SubmissionEntity>,
    @InjectRepository(VideoQualityResultEntity)
    private readonly results: Repository<VideoQualityResultEntity>,
    private readonly prompts: AiQualityPromptService,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    @Inject(AI_QUALITY_EVALUATOR_FACTORY)
    private readonly evaluatorFactory: AiQualityEvaluatorFactory,
  ) {}

  async process(input: {
    submissionId: string;
  }): Promise<AiQualityProcessOutcome> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    let acquired = false;
    try {
      const rows = (await queryRunner.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
        [input.submissionId],
      )) as Array<{ acquired: boolean }>;
      acquired = rows[0]?.acquired === true;
      if (!acquired) return "skipped";

      const existing = await this.results.findOneBy({
        submissionId: input.submissionId,
      });
      if (existing && TERMINAL_RESULT_STATUSES.has(existing.status)) {
        return "skipped";
      }
      const activePrompt = existing ? null : await this.prompts.getActive();
      let task: Awaited<ReturnType<AiQualityAnalysisService["begin"]>>;
      try {
        task = await this.begin(input.submissionId, activePrompt);
      } catch (error) {
        const classified = classify(error);
        if (classified instanceof TerminalAiQualityError) {
          await this.markTerminalFailure(input.submissionId, classified);
        }
        throw classified;
      }
      if (!task) return "skipped";

      const directory = await mkdtemp(join(tmpdir(), "evdp-ai-quality-"));
      const mediaPath = join(
        directory,
        `original${extname(task.submission.originalFileName).toLowerCase()}`,
      );
      try {
        await this.storage.downloadObject({
          objectKey: task.submission.objectKey,
          destinationPath: mediaPath,
        });
        const exactDuplicate = await this.hasExactDuplicate(
          task.submission.id,
          task.submission.checksumSha256,
        );
        const committed = await loadVideoQualityPrompt(
          videoQualityPromptPath(),
        );
        const evaluator = this.evaluatorFactory({
          ...committed,
          systemPrompt: task.result.systemPromptSnapshot,
          contentSha256: task.result.promptContentSha256,
          initialModel: task.result.initialModel,
          reviewModel: task.result.reviewModel,
        });
        const normalized = await evaluator.evaluate({
          videoId: task.submission.id,
          filePath: mediaPath,
          workDirectory: join(directory, "evidence"),
          registerSha256: (sha256) => {
            if (sha256 !== task.submission.checksumSha256) {
              throw new TerminalAiQualityError("AI 质检视频 SHA-256 校验失败");
            }
            return exactDuplicate;
          },
        });
        await this.complete(task.submission.id, normalized);
        return "processed";
      } catch (error) {
        const classified = classify(error);
        if (classified instanceof TerminalAiQualityError) {
          await this.markTerminalFailure(task.submission.id, classified);
        } else {
          await this.markRetryPending(task.submission.id, classified);
        }
        throw classified;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    } finally {
      if (acquired) {
        await queryRunner
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
            input.submissionId,
          ])
          .catch(() => undefined);
      }
      await queryRunner.release();
    }
  }

  async markTerminalFailure(
    submissionId: string,
    error: unknown,
  ): Promise<void> {
    const message = compactError(error);
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(VideoQualityResultEntity).update(
        { submissionId },
        {
          status: "system_failed",
          lastError: message,
          completedAt: new Date(),
        },
      );
      await manager.getRepository(SubmissionEntity).update(
        { id: submissionId },
        {
          processingStatus: "system_failed",
          failureCode: "AI_QUALITY_FAILED",
          failureMessage: message,
        },
      );
    });
  }

  private async begin(
    submissionId: string,
    activePrompt: VideoQualityPromptVersionEntity | null,
  ): Promise<{
    submission: SubmissionEntity;
    result: VideoQualityResultEntity;
  } | null> {
    return this.dataSource.transaction(async (manager) => {
      const submission = await manager.getRepository(SubmissionEntity).findOne({
        where: { id: submissionId },
        lock: { mode: "pessimistic_write" },
      });
      if (!submission) throw new TerminalAiQualityError("视频提交不存在");
      if (submission.uploadStatus !== "uploaded") {
        throw new TerminalAiQualityError("视频对象尚未完成上传");
      }
      const metadata = await manager
        .getRepository(MediaMetadataEntity)
        .findOneBy({ submissionId });
      if (!metadata) {
        throw new TerminalAiQualityError("视频媒体元数据尚未生成");
      }

      const repository = manager.getRepository(VideoQualityResultEntity);
      let result = await repository.findOne({
        where: { submissionId },
        lock: { mode: "pessimistic_write" },
      });
      if (result && TERMINAL_RESULT_STATUSES.has(result.status)) return null;
      if (!result) {
        if (!activePrompt) {
          throw new TerminalAiQualityError("当前 AI 质检提示词不存在");
        }
        result = repository.create({
          submissionId,
          status: "queued",
          attempts: 0,
          promptVersionId: activePrompt.id,
          promptRevision: activePrompt.revision,
          promptContentSha256: activePrompt.contentSha256,
          systemPromptSnapshot: activePrompt.systemPrompt,
          initialModel: activePrompt.initialModel,
          reviewModel: activePrompt.reviewModel,
          modelRuns: [],
          recommendations: [],
          deductions: [],
          reviewReasons: [],
        });
      }
      result.status = "running";
      result.attempts += 1;
      result.startedAt = new Date();
      result.completedAt = null;
      result.lastError = null;
      result = await repository.save(result);
      submission.processingStatus = "ai_processing";
      submission.failureCode = null;
      submission.failureMessage = null;
      await manager.getRepository(SubmissionEntity).save(submission);
      return { submission, result };
    });
  }

  private async hasExactDuplicate(
    submissionId: string,
    checksumSha256: string,
  ): Promise<boolean> {
    return (
      (await this.results
        .createQueryBuilder("quality")
        .innerJoin(SubmissionEntity, "submission", "submission.id = quality.submission_id")
        .where("quality.submission_id <> :submissionId", { submissionId })
        .andWhere("submission.checksum_sha256 = :checksumSha256", {
          checksumSha256,
        })
        .andWhere("quality.status IN (:...statuses)", {
          statuses: ["scored", "hard_reject", "review_pending"],
        })
        .getCount()) > 0
    );
  }

  private async complete(
    submissionId: string,
    normalized: NormalizedVideoQcResultV1,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(VideoQualityResultEntity);
      const result = await repository.findOne({
        where: { submissionId },
        lock: { mode: "pessimistic_write" },
      });
      if (!result) throw new Error("AI 质检运行记录不存在");
      result.status = resultStatus(normalized);
      result.modelRuns = normalized.modelRuns as unknown as Array<
        Record<string, unknown>
      >;
      result.finalScore = decimal(normalized.finalScore, 1);
      result.rawTotalScore = decimal(normalized.rawTotalScore, 1);
      result.settlementRatio = decimal(normalized.settlementRatio, 4);
      result.invalidDurationMs = String(normalized.invalidDurationMs);
      result.billableDurationMs = String(normalized.billableDurationMs);
      result.summary = normalized.summary;
      result.recommendations = normalized.recommendations;
      result.deductions = normalized.deductions as unknown as Array<
        Record<string, unknown>
      >;
      result.reviewRequired = normalized.reviewRequired;
      result.reviewReasons = normalized.reviewReasons;
      result.normalizedResult = normalized as unknown as Record<string, unknown>;
      result.rawModelResult = normalized.rawModelResult as unknown as Record<
        string,
        unknown
      >;
      result.lastError = null;
      result.completedAt = new Date();
      await repository.save(result);
      await manager.getRepository(SubmissionEntity).update(
        { id: submissionId },
        {
          processingStatus: "completed",
          failureCode: null,
          failureMessage: null,
        },
      );
    });
  }

  private async markRetryPending(
    submissionId: string,
    error: unknown,
  ): Promise<void> {
    const message = compactError(error);
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(VideoQualityResultEntity).update(
        { submissionId },
        { status: "queued", lastError: message, completedAt: null },
      );
      await manager.getRepository(SubmissionEntity).update(
        { id: submissionId },
        {
          processingStatus: "awaiting_ai",
          failureCode: null,
          failureMessage: null,
        },
      );
    });
  }
}
