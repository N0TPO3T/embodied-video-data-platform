import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository, type QueryRunner } from "typeorm";

import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import type { LabelSetVersionEntity } from "../database/entities/label-set-version.entity.js";
import { QualityRuleVersionEntity } from "../database/entities/quality-rule-version.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import {
  VideoQualityResultEntity,
  type VideoQualityProgressStage,
  type VideoQualityResultStatus,
} from "../database/entities/video-quality-result.entity.js";
import type { VideoQualityPromptVersionEntity } from "../database/entities/video-quality-prompt-version.entity.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import { BailianRequestError } from "../video-quality/qwen-video-quality.provider.js";
import { loadVideoQualityPrompt } from "../video-quality/prompt-loader.js";
import type {
  NormalizedVideoQcResultV1,
  QualityStage,
} from "../video-quality/video-quality.types.js";
import {
  labelSetSnapshot,
  passesQualityRule,
  qualityRuleSnapshot,
  settlementRatioForScore,
  type QualityRuleSnapshot,
} from "../rules/rule-calculator.js";
import { videoQualityPromptPath } from "./ai-quality.config.js";
import { AiQualityPromptService } from "./ai-quality-prompt.service.js";
import {
  AI_QUALITY_EVALUATOR_FACTORY,
  type AiQualityEvaluatorFactory,
} from "./ai-quality.tokens.js";
import { LabelSetService } from "./label-set.service.js";
import { QualityRuleService } from "./quality-rule.service.js";
import {
  evaluationSystemPrompt,
  promptContentSha256,
} from "./evaluation-context.js";

const TERMINAL_RESULT_STATUSES = new Set<VideoQualityResultStatus>([
  "scored",
  "hard_reject",
  "review_pending",
  "system_failed",
]);
const SENSITIVE_RESULT_PATTERN =
  /PRIVACY_OR_SAFETY|privacy|sensitive|隐私|敏感|合规|安全|人脸|门牌|定位|账号/u;

export class TerminalAiQualityError extends Error {}

export class RetryableAiQualityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export type AiQualityProcessOutcome = "processed" | "skipped" | "lock_busy";

type PostgresSessionQueryRunner = QueryRunner & {
  releasePostgresConnection(error?: Error): Promise<void>;
};

async function releaseSubmissionLock(
  queryRunner: QueryRunner,
  submissionId: string,
): Promise<void> {
  try {
    const rows = (await queryRunner.query(
      "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
      [submissionId],
    )) as Array<{ unlocked: boolean }>;
    if (rows[0]?.unlocked !== true) {
      throw new Error("AI submission advisory lock was not held by this session");
    }
  } catch (error) {
    // TypeORM's normal release returns the client to pg-pool. If unlock failed,
    // discard the physical PostgreSQL session instead so a session lock can
    // never leak into the pool.
    await (
      queryRunner as PostgresSessionQueryRunner
    ).releasePostgresConnection(
      error instanceof Error ? error : new Error("AI advisory unlock failed"),
    );
    return;
  }
  await queryRunner.release();
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new RetryableAiQualityError("AI 质检任务已超时取消");
}

async function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) throw abortReason(signal);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

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
  if (error instanceof RetryableAiQualityError) return error;
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

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return Object.values(value as Record<string, unknown>).map(textValue).join(" ");
}

function containsSensitiveRisk(result: NormalizedVideoQcResultV1): boolean {
  return SENSITIVE_RESULT_PATTERN.test(
    [
      ...result.reviewReasons,
      result.summary,
      ...result.hardVeto.reasons.map(textValue),
      ...result.deductions.flatMap((deduction) => [
        deduction.reason_code,
        deduction.description,
      ]),
    ].join(" "),
  );
}

function qualityProgressFromStage(
  stage: QualityStage,
): VideoQualityProgressStage | null {
  if (stage === "media_analysis") return "media_analysis";
  if (stage === "initial_review") return "initial_review";
  if (stage === "secondary_review") return "secondary_review";
  if (stage === "completed" || stage === "review_pending") return "completed";
  if (stage === "system_failed" || stage === "cancelled") return "failed";
  return null;
}

function enforceExactDuplicate(
  result: NormalizedVideoQcResultV1,
): NormalizedVideoQcResultV1 {
  return {
    ...result,
    evaluationStatus: "hard_reject",
    settlementRatio: 0,
    hardVeto: {
      triggered: true,
      reasons: [...result.hardVeto.reasons, "EXACT_DUPLICATE"],
      candidates: result.hardVeto.candidates,
    },
    summary: `服务端 SHA-256 精确重复校验未通过。${result.summary}`,
    reviewRequired: false,
    reviewReasons: [
      ...new Set([
        ...result.reviewReasons,
        "文件 SHA-256 与更早登记的视频完全一致",
      ]),
    ],
  };
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
    private readonly qualityRules: QualityRuleService,
    private readonly labelSets: LabelSetService,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    @Inject(AI_QUALITY_EVALUATOR_FACTORY)
    private readonly evaluatorFactory: AiQualityEvaluatorFactory,
  ) {}

  async process(input: {
    submissionId: string;
    signal?: AbortSignal;
    terminalOnRetryableFailure?: boolean;
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
      if (!acquired) return "lock_busy";

      const existing = await this.results.findOneBy({
        submissionId: input.submissionId,
      });
      if (existing && TERMINAL_RESULT_STATUSES.has(existing.status)) {
        return "skipped";
      }
      let task: Awaited<ReturnType<AiQualityAnalysisService["begin"]>>;
      try {
        const activePrompt = existing ? null : await this.prompts.getActive();
        const qualityRule = existing
          ? null
          : await this.qualityRules.ensureDefault();
        const labelSet = existing ? null : await this.labelSets.ensureDefault();
        task = await this.begin(input.submissionId, {
          activePrompt,
          qualityRule,
          labelSet,
        });
      } catch (error) {
        const classified = classify(error);
        if (
          classified instanceof TerminalAiQualityError ||
          (input.terminalOnRetryableFailure && !input.signal?.aborted)
        ) {
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
        await this.updateProgress(task.submission.id, "downloading");
        await abortable(
          this.storage.downloadObject({
            objectKey: task.submission.objectKey,
            destinationPath: mediaPath,
          }),
          input.signal,
        );
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
        const normalized = await abortable(
          evaluator.evaluate(
            {
              videoId: task.submission.id,
              filePath: mediaPath,
              workDirectory: join(directory, "evidence"),
              registerSha256: (sha256) => {
                if (sha256 !== task.submission.checksumSha256) {
                  throw new TerminalAiQualityError(
                    "AI 质检视频 SHA-256 校验失败",
                  );
                }
                return exactDuplicate;
              },
            },
            (stage) => {
              const progress = qualityProgressFromStage(stage);
              if (progress) {
                void this.updateProgress(task.submission.id, progress);
              }
            },
            input.signal,
          ),
          input.signal,
        );
        await this.complete(
          task.submission.id,
          exactDuplicate ? enforceExactDuplicate(normalized) : normalized,
        );
        return "processed";
      } catch (error) {
        const classified = classify(error);
        if (
          classified instanceof TerminalAiQualityError ||
          (input.terminalOnRetryableFailure && !input.signal?.aborted)
        ) {
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
        await releaseSubmissionLock(queryRunner, input.submissionId);
      } else {
        await queryRunner.release();
      }
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
          progressStage: "failed",
          progressUpdatedAt: new Date(),
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

  /**
   * 把卡住的任务（运行超时或 Worker 心跳过期）标记为 stuck。
   * stuck 不是终态：管理员可在 AI 任务页重新排队恢复。
   */
  async markStuck(submissionId: string, reason: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(VideoQualityResultEntity).update(
        { submissionId },
        {
          status: "stuck",
          progressStage: "stuck",
          progressUpdatedAt: new Date(),
          stuckReason: reason,
          lastError: reason,
        },
      );
      await manager.getRepository(SubmissionEntity).update(
        { id: submissionId },
        {
          processingStatus: "stuck",
          failureCode: "WORKER_STUCK",
          failureMessage: reason,
        },
      );
    });
  }

  private async updateProgress(
    submissionId: string,
    stage: VideoQualityProgressStage,
  ): Promise<void> {
    await this.results.update(
      { submissionId },
      { progressStage: stage, progressUpdatedAt: new Date() },
    );
  }

  private async begin(
    submissionId: string,
    context: {
      activePrompt: VideoQualityPromptVersionEntity | null;
      qualityRule: QualityRuleVersionEntity | null;
      labelSet: LabelSetVersionEntity | null;
    },
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
        if (!context.activePrompt || !context.qualityRule || !context.labelSet) {
          throw new TerminalAiQualityError("当前 AI 质检提示词不存在");
        }
        const qualitySnapshot = qualityRuleSnapshot(context.qualityRule);
        const labelsSnapshot = labelSetSnapshot(context.labelSet);
        const systemPromptSnapshot = evaluationSystemPrompt({
          basePrompt: context.activePrompt.systemPrompt,
          qualityRule: qualitySnapshot,
          labelSet: labelsSnapshot,
        });
        result = repository.create({
          submissionId,
          status: "queued",
          attempts: 0,
          promptVersionId: context.activePrompt.id,
          promptRevision: context.activePrompt.revision,
          promptContentSha256: promptContentSha256(systemPromptSnapshot),
          systemPromptSnapshot,
          qualityRuleVersionId: context.qualityRule.id,
          qualityRuleRevision: context.qualityRule.revision,
          labelSetVersionId: context.labelSet.id,
          labelSetRevision: context.labelSet.revision,
          qualityRuleSnapshot: qualitySnapshot,
          labelSetSnapshot: labelsSnapshot,
          initialModel: context.activePrompt.initialModel,
          reviewModel: context.activePrompt.reviewModel,
          modelRuns: [],
          recommendations: [],
          deductions: [],
          reviewReasons: [],
        });
      }
      result.status = "running";
      result.progressStage = "queued";
      result.progressUpdatedAt = new Date();
      result.stuckReason = null;
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
    const canonical = await this.submissions
      .createQueryBuilder("submission")
      .where("submission.checksumSha256 = :checksumSha256", {
        checksumSha256,
      })
      .andWhere("submission.uploadStatus = :uploaded", {
        uploaded: "uploaded",
      })
      .andWhere("submission.storageStatus = :available", {
        available: "available",
      })
      .orderBy("COALESCE(submission.uploadedAt, submission.createdAt)", "ASC")
      .addOrderBy("submission.createdAt", "ASC")
      .addOrderBy("submission.id", "ASC")
      .getOne();
    return canonical !== null && canonical.id !== submissionId;
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
      const status = resultStatus(normalized);
      const qualityRule = await this.qualityRuleForResult(manager, result);
      const finalScore = normalized.finalScore ?? 0;
      const passed =
        status === "scored"
          ? passesQualityRule(finalScore, qualityRule.passThreshold)
          : status === "hard_reject"
            ? false
            : null;
      const settlementRatio =
        status === "scored"
          ? settlementRatioForScore({
              score: finalScore,
              passThreshold: qualityRule.passThreshold,
            })
          : status === "hard_reject"
            ? 0
            : null;
      const persistedNormalized = { ...normalized, settlementRatio };
      result.status = status;
      result.progressStage = "completed";
      result.progressUpdatedAt = new Date();
      result.stuckReason = null;
      result.modelRuns = normalized.modelRuns as unknown as Array<
        Record<string, unknown>
      >;
      result.finalScore = decimal(normalized.finalScore, 1);
      result.rawTotalScore = decimal(normalized.rawTotalScore, 1);
      result.settlementRatio = decimal(settlementRatio, 4);
      result.passed = passed;
      result.invalidDurationMs = String(normalized.invalidDurationMs);
      result.billableDurationMs = String(normalized.billableDurationMs);
      result.summary = normalized.summary;
      result.recommendations = normalized.recommendations;
      result.deductions = normalized.deductions as unknown as Array<
        Record<string, unknown>
      >;
      result.reviewRequired = normalized.reviewRequired;
      result.reviewReasons = normalized.reviewReasons;
      result.normalizedResult = persistedNormalized as unknown as Record<
        string,
        unknown
      >;
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
          ...(containsSensitiveRisk(normalized)
            ? {
                assetStatus: "quarantined" as const,
                quarantineReason: "AI 命中敏感或隐私风险",
                quarantinedAt: new Date(),
                quarantinedByAccountId: null,
                quarantinedByName: "AI 质检",
              }
            : {
                assetStatus: "active" as const,
                quarantineReason: null,
                quarantinedAt: null,
                quarantinedByAccountId: null,
                quarantinedByName: null,
              }),
        },
      );
    });
  }

  private async qualityRuleForResult(
    manager: import("typeorm").EntityManager,
    result: VideoQualityResultEntity,
  ): Promise<QualityRuleSnapshot> {
    if (result.qualityRuleSnapshot) return result.qualityRuleSnapshot;
    if (result.qualityRuleVersionId) {
      const rule = await manager
        .getRepository(QualityRuleVersionEntity)
        .findOneBy({ id: result.qualityRuleVersionId });
      if (rule) return qualityRuleSnapshot(rule);
    }
    return {
      id: "legacy-default",
      revision: 0,
      version: "legacy-default",
      passThreshold: 60,
      description: "历史任务默认质量规则",
    };
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
