import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Inject, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

import { AnnotationReviewEntity } from "../database/entities/annotation-review.entity.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import {
  TaskBoundaryRefinementEntity,
  type TaskBoundaryRefinementExecutionStatus,
} from "../database/entities/task-boundary-refinement.entity.js";
import { TaskSegmentAssetEntity } from "../database/entities/task-segment-asset.entity.js";
import { acceptedAnnotationRun } from "../delivery/delivery-annotation.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import {
  TASK_BOUNDARY_FRAME_SAMPLER,
  type TaskBoundaryFrameSampler,
  type TaskBoundaryFrameSample,
} from "./task-boundary-frame-sampler.js";
import {
  TASK_BOUNDARY_REFINEMENT_PROVIDER,
  type TaskBoundaryRefinementOutput,
  type TaskBoundaryRefinementProvider,
} from "./task-boundary-refinement.provider.js";
import { TASK_BOUNDARY_REFINEMENT_POLICY_VERSION } from "./task-boundary-refinement.policy.js";
import {
  enqueueTaskSegmentAsset,
  taskSegmentTargetBounds,
} from "./task-segment.service.js";

type JsonRecord = Record<string, unknown>;

export type TaskBoundaryRefinementOutcome =
  | "succeeded"
  | "fallback"
  | "system_failed"
  | "already_claimed";

type ValidatedBoundary = {
  refinedStartMs: number | null;
  refinedEndMs: number | null;
  selectedStartMs: number;
  selectedEndMs: number;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function taskContext(value: unknown): {
  taskLabel: string;
  startMs: number;
  endMs: number;
} | null {
  const task = record(value);
  if (!task) return null;
  const startMs = finiteNumber(task.start_ms);
  const endMs = finiteNumber(task.end_ms);
  if (startMs === null || endMs === null) return null;
  return {
    taskLabel: stringValue(task.task_label, "Task"),
    startMs,
    endMs,
  };
}

export function validateTaskBoundaryRefinementOutput(input: {
  output: TaskBoundaryRefinementOutput;
  taskIndex: number;
  coarseStartMs: number;
  coarseEndMs: number;
  videoDurationMs: number;
  sample: TaskBoundaryFrameSample;
}): { value: ValidatedBoundary | null; issues: string[] } {
  const issues: string[] = [];
  const sampled = new Set(input.sample.frames.map((frame) => frame.timestampMs));
  const startSampled = new Set(
    input.sample.frames
      .filter((frame) => frame.windows.includes("start"))
      .map((frame) => frame.timestampMs),
  );
  const endSampled = new Set(
    input.sample.frames
      .filter((frame) => frame.windows.includes("end"))
      .map((frame) => frame.timestampMs),
  );
  if (input.output.task_index !== input.taskIndex) {
    issues.push("task_index 与请求不一致");
  }
  if (input.output.start.coarse_timestamp_ms !== input.coarseStartMs) {
    issues.push("start.coarse_timestamp_ms 与当前任务不一致");
  }
  if (input.output.end.coarse_timestamp_ms !== input.coarseEndMs) {
    issues.push("end.coarse_timestamp_ms 与当前任务不一致");
  }

  const validateSide = (
    side: "start" | "end",
    coarseMs: number,
    samples: Set<number>,
  ): number | null => {
    const output = input.output[side];
    for (const timestampMs of output.evidence_timestamps_ms) {
      if (!sampled.has(timestampMs)) {
        issues.push(`${side}.evidence_timestamps_ms 包含未提供的采样时间 ${timestampMs}`);
      }
    }
    if (output.status === "not_observable") {
      if (output.refined_timestamp_ms !== null) {
        issues.push(`${side}.not_observable 不允许 refined_timestamp_ms`);
      }
      return null;
    }
    if (output.status === "unchanged") {
      if (
        output.refined_timestamp_ms !== null &&
        output.refined_timestamp_ms !== coarseMs
      ) {
        issues.push(`${side}.unchanged 只能返回 null 或 coarse timestamp`);
      }
      if (
        output.refined_timestamp_ms !== null &&
        !samples.has(output.refined_timestamp_ms)
      ) {
        issues.push(`${side}.unchanged timestamp 不属于实际采样帧`);
      }
      return null;
    }
    const refined = output.refined_timestamp_ms;
    if (refined === null) {
      issues.push(`${side}.refined 缺少 refined_timestamp_ms`);
      return null;
    }
    if (!samples.has(refined)) {
      issues.push(`${side}.refined timestamp 不属于该侧实际采样帧`);
    }
    if (Math.abs(refined - coarseMs) > 3_000) {
      issues.push(`${side}.refined timestamp 超过 coarse ±3000ms`);
    }
    if (refined < 0 || refined > input.videoDurationMs) {
      issues.push(`${side}.refined timestamp 超出视频范围`);
    }
    return refined;
  };

  const refinedStartMs = validateSide("start", input.coarseStartMs, startSampled);
  const refinedEndMs = validateSide("end", input.coarseEndMs, endSampled);
  const selectedStartMs = refinedStartMs ?? input.coarseStartMs;
  const selectedEndMs = refinedEndMs ?? input.coarseEndMs;
  if (selectedStartMs >= selectedEndMs) {
    issues.push("精修后的最终 start 必须小于 end");
  }
  return {
    value:
      issues.length === 0
        ? { refinedStartMs, refinedEndMs, selectedStartMs, selectedEndMs }
        : null,
    issues,
  };
}

@Injectable()
export class TaskBoundaryRefinementProcessor {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(TASK_BOUNDARY_FRAME_SAMPLER)
    private readonly sampler: TaskBoundaryFrameSampler,
    @Inject(TASK_BOUNDARY_REFINEMENT_PROVIDER)
    private readonly provider: TaskBoundaryRefinementProvider,
  ) {}

  async process(input: {
    refinementId: string;
    recoverRunning?: boolean;
    signal?: AbortSignal;
  }): Promise<TaskBoundaryRefinementOutcome> {
    const claimed = await this.claim(
      input.refinementId,
      input.recoverRunning ?? false,
    );
    if (!claimed) return "already_claimed";
    if (claimed.recovered) {
      return this.completeFallback({
        refinementId: claimed.refinement.id,
        executionStatus: "system_failed",
        failureCode: "REFINEMENT_INTERRUPTED",
        failureMessage: "边界精修在模型调用后中断；为保证单任务最多一次调用，回退 coarse boundary",
        validationIssues: ["running refinement recovered without a second model call"],
      });
    }

    let directory: string | null = null;
    try {
      const context = await this.loadContext(claimed.refinement);
      if (!context) {
        return await this.completeFallback({
          refinementId: claimed.refinement.id,
          executionStatus: "fallback",
          failureCode: "REFINEMENT_SOURCE_INVALID",
          failureMessage: "来源 Run、Submission、媒体元数据或正式发布快照无效",
        });
      }
      directory = await mkdtemp(join(tmpdir(), "evdp-task-boundary-"));
      const sourcePath = join(directory, "source-video");
      const framesDirectory = join(directory, "frames");
      await mkdir(framesDirectory, { recursive: true });
      await this.storage.downloadObject({
        objectKey: context.submission.objectKey,
        destinationPath: sourcePath,
      });
      const sample = await this.sampler.extract({
        sourcePath,
        workDirectory: framesDirectory,
        coarseStartMs: claimed.refinement.coarseStartMs,
        coarseEndMs: claimed.refinement.coarseEndMs,
        videoDurationMs: context.durationMs,
        signal: input.signal,
      });
      await this.dataSource.getRepository(TaskBoundaryRefinementEntity).update(
        { id: claimed.refinement.id, executionStatus: "running" },
        { sampleManifest: sample.manifest },
      );
      const result = await this.provider.refine(
        {
          submissionId: claimed.refinement.submissionId,
          annotationRunId: claimed.refinement.annotationRunId,
          taskIndex: claimed.refinement.taskIndex,
          taskLabel: context.asset.taskLabel,
          taskVerb: context.asset.taskVerb,
          coarseStartMs: claimed.refinement.coarseStartMs,
          coarseEndMs: claimed.refinement.coarseEndMs,
          videoDurationMs: context.durationMs,
          previousTask: context.previousTask,
          nextTask: context.nextTask,
          frames: sample.frames,
          modelVersion: context.run.model!,
        },
        input.signal,
      );
      const validated = validateTaskBoundaryRefinementOutput({
        output: result.output,
        taskIndex: claimed.refinement.taskIndex,
        coarseStartMs: claimed.refinement.coarseStartMs,
        coarseEndMs: claimed.refinement.coarseEndMs,
        videoDurationMs: context.durationMs,
        sample,
      });
      if (!validated.value) {
        return await this.completeFallback({
          refinementId: claimed.refinement.id,
          executionStatus: "fallback",
          failureCode: "REFINEMENT_OUTPUT_INVALID",
          failureMessage: validated.issues.join("; "),
          validationIssues: validated.issues,
          sampleManifest: sample.manifest,
          rawModelOutput: result.rawModelOutput,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          modelLatencyMs: result.latencyMs,
          modelVersion: result.responseModel,
        });
      }
      await this.completeSuccess({
        refinementId: claimed.refinement.id,
        output: result.output,
        boundary: validated.value,
        sampleManifest: sample.manifest,
        rawModelOutput: result.rawModelOutput,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        modelLatencyMs: result.latencyMs,
        modelVersion: result.responseModel,
        durationMs: context.durationMs,
      });
      return "succeeded";
    } catch (error) {
      return await this.completeFallback({
        refinementId: claimed.refinement.id,
        executionStatus: "fallback",
        failureCode: "REFINEMENT_PROVIDER_FAILED",
        failureMessage: errorMessage(error),
      });
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  async forceSystemFailed(refinementId: string, error: unknown): Promise<void> {
    await this.completeFallback({
      refinementId,
      executionStatus: "system_failed",
      failureCode: "REFINEMENT_SYSTEM_FAILED",
      failureMessage: errorMessage(error),
    });
  }

  private async claim(
    refinementId: string,
    recoverRunning: boolean,
  ): Promise<{
    refinement: TaskBoundaryRefinementEntity;
    recovered: boolean;
  } | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TaskBoundaryRefinementEntity);
      const refinement = await repository.findOne({
        where: { id: refinementId },
        lock: { mode: "pessimistic_write" },
      });
      if (!refinement) return null;
      if (["succeeded", "fallback", "system_failed"].includes(refinement.executionStatus)) {
        return null;
      }
      if (refinement.executionStatus === "running") {
        return recoverRunning ? { refinement, recovered: true } : null;
      }
      if (refinement.executionStatus !== "queued") return null;
      refinement.executionStatus = "running";
      refinement.failureCode = null;
      refinement.failureMessage = null;
      refinement.completedAt = null;
      return { refinement: await repository.save(refinement), recovered: false };
    });
  }

  private async loadContext(refinement: TaskBoundaryRefinementEntity): Promise<{
    run: AnnotationRunEntity;
    submission: SubmissionEntity;
    asset: TaskSegmentAssetEntity;
    durationMs: number;
    previousTask: { taskLabel: string; startMs: number; endMs: number } | null;
    nextTask: { taskLabel: string; startMs: number; endMs: number } | null;
  } | null> {
    const [run, submission, metadata, asset] = await Promise.all([
      this.dataSource.getRepository(AnnotationRunEntity).findOneBy({ id: refinement.annotationRunId }),
      this.dataSource.getRepository(SubmissionEntity).findOneBy({ id: refinement.submissionId }),
      this.dataSource.getRepository(MediaMetadataEntity).findOneBy({ submissionId: refinement.submissionId }),
      this.dataSource.getRepository(TaskSegmentAssetEntity).findOneBy({ boundaryRefinementId: refinement.id }),
    ]);
    if (!run || !submission || !metadata || !asset || run.submissionId !== submission.id) return null;
    const review = run.reviewRevision > 0
      ? await this.dataSource.getRepository(AnnotationReviewEntity).findOneBy({
          annotationRunId: run.id,
          revision: run.reviewRevision,
        })
      : null;
    const accepted = acceptedAnnotationRun(run, review);
    const durationMs = Math.round(Number(metadata.durationSeconds) * 1_000);
    if (
      !accepted ||
      !run.model ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      submission.storageStatus !== "available"
    ) return null;
    const tasks = Array.isArray(accepted.effective.tasks) ? accepted.effective.tasks : [];
    return {
      run,
      submission,
      asset,
      durationMs,
      previousTask: refinement.taskIndex > 0 ? taskContext(tasks[refinement.taskIndex - 1]) : null,
      nextTask: taskContext(tasks[refinement.taskIndex + 1]),
    };
  }

  private async completeSuccess(input: {
    refinementId: string;
    output: TaskBoundaryRefinementOutput;
    boundary: ValidatedBoundary;
    sampleManifest: unknown;
    rawModelOutput: unknown;
    inputTokens: number | null;
    outputTokens: number | null;
    modelLatencyMs: number;
    modelVersion: string | null;
    durationMs: number;
  }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const refinements = manager.getRepository(TaskBoundaryRefinementEntity);
      const assets = manager.getRepository(TaskSegmentAssetEntity);
      const refinement = await refinements.findOne({
        where: { id: input.refinementId },
        lock: { mode: "pessimistic_write" },
      });
      if (!refinement || refinement.executionStatus !== "running") return;
      const asset = await assets.findOne({
        where: { boundaryRefinementId: refinement.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!asset) throw new Error("边界精修关联的 TaskSegmentAsset 不存在");
      refinement.refinedStartMs = input.boundary.refinedStartMs;
      refinement.refinedEndMs = input.boundary.refinedEndMs;
      refinement.startStatus = input.output.start.status;
      refinement.endStatus = input.output.end.status;
      refinement.startReasonCode = input.output.start.reason_code;
      refinement.endReasonCode = input.output.end.reason_code;
      refinement.sampleManifest = input.sampleManifest;
      refinement.rawModelOutput = input.rawModelOutput;
      refinement.validationIssues = [];
      refinement.inputTokens = input.inputTokens;
      refinement.outputTokens = input.outputTokens;
      refinement.modelLatencyMs = input.modelLatencyMs;
      if (input.modelVersion) refinement.modelVersion = input.modelVersion;
      refinement.executionStatus = "succeeded";
      refinement.failureCode = null;
      refinement.failureMessage = null;
      refinement.completedAt = new Date();
      this.applyBoundary(asset, {
        refinedStartMs: input.boundary.refinedStartMs,
        refinedEndMs: input.boundary.refinedEndMs,
        selectedStartMs: input.boundary.selectedStartMs,
        selectedEndMs: input.boundary.selectedEndMs,
        durationMs: input.durationMs,
        source:
          input.boundary.refinedStartMs !== null || input.boundary.refinedEndMs !== null
            ? "refined"
            : "coarse",
      });
      await refinements.save(refinement);
      await assets.save(asset);
      if (asset.generationStatus === "queued") {
        await enqueueTaskSegmentAsset(manager, asset);
      }
    });
  }

  private async completeFallback(input: {
    refinementId: string;
    executionStatus: Extract<TaskBoundaryRefinementExecutionStatus, "fallback" | "system_failed">;
    failureCode: string;
    failureMessage: string;
    validationIssues?: unknown;
    sampleManifest?: unknown;
    rawModelOutput?: unknown;
    inputTokens?: number | null;
    outputTokens?: number | null;
    modelLatencyMs?: number | null;
    modelVersion?: string | null;
  }): Promise<"fallback" | "system_failed"> {
    await this.dataSource.transaction(async (manager) => {
      const refinements = manager.getRepository(TaskBoundaryRefinementEntity);
      const assets = manager.getRepository(TaskSegmentAssetEntity);
      const refinement = await refinements.findOne({
        where: { id: input.refinementId },
        lock: { mode: "pessimistic_write" },
      });
      if (!refinement) return;
      if (["succeeded", "fallback", "system_failed"].includes(refinement.executionStatus)) return;
      const asset = await assets.findOne({
        where: { boundaryRefinementId: refinement.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!asset) throw new Error("边界精修关联的 TaskSegmentAsset 不存在");
      const metadata = await manager.getRepository(MediaMetadataEntity).findOneBy({
        submissionId: refinement.submissionId,
      });
      const durationMs = Math.round(Number(metadata?.durationSeconds) * 1_000);
      refinement.refinedStartMs = null;
      refinement.refinedEndMs = null;
      refinement.startStatus = "failed";
      refinement.endStatus = "failed";
      refinement.startReasonCode = null;
      refinement.endReasonCode = null;
      refinement.validationIssues = input.validationIssues ?? [input.failureMessage];
      if (input.sampleManifest !== undefined) refinement.sampleManifest = input.sampleManifest;
      if (input.rawModelOutput !== undefined) refinement.rawModelOutput = input.rawModelOutput;
      refinement.inputTokens = input.inputTokens ?? refinement.inputTokens;
      refinement.outputTokens = input.outputTokens ?? refinement.outputTokens;
      refinement.modelLatencyMs = input.modelLatencyMs ?? refinement.modelLatencyMs;
      if (input.modelVersion) refinement.modelVersion = input.modelVersion;
      refinement.executionStatus = input.executionStatus;
      refinement.failureCode = input.failureCode;
      refinement.failureMessage = input.failureMessage.slice(0, 2_000);
      refinement.completedAt = new Date();
      this.applyBoundary(asset, {
        refinedStartMs: null,
        refinedEndMs: null,
        selectedStartMs: asset.sourceStartMs,
        selectedEndMs: asset.sourceEndMs,
        durationMs,
        source: "coarse_fallback",
      });
      await refinements.save(refinement);
      await assets.save(asset);
      if (asset.generationStatus === "queued") {
        await enqueueTaskSegmentAsset(manager, asset);
      }
    });
    return input.executionStatus;
  }

  private applyBoundary(
    asset: TaskSegmentAssetEntity,
    input: {
      refinedStartMs: number | null;
      refinedEndMs: number | null;
      selectedStartMs: number;
      selectedEndMs: number;
      durationMs: number;
      source: "coarse" | "refined" | "coarse_fallback";
    },
  ): void {
    asset.refinedStartMs = input.refinedStartMs;
    asset.refinedEndMs = input.refinedEndMs;
    asset.boundarySource = input.source;
    asset.boundaryRefinementPolicyVersion = TASK_BOUNDARY_REFINEMENT_POLICY_VERSION;
    asset.failureCode = null;
    asset.failureMessage = null;
    asset.completedAt = null;
    if (
      !Number.isFinite(input.durationMs) ||
      input.selectedStartMs < 0 ||
      input.selectedEndMs <= input.selectedStartMs ||
      input.selectedEndMs > input.durationMs
    ) {
      asset.generationStatus = "skipped";
      asset.failureCode = "INVALID_TIME_RANGE";
      asset.failureMessage = "精修或回退后的任务时间区间无效";
      asset.completedAt = new Date();
      return;
    }
    if (asset.completion === "uncertain") {
      asset.generationStatus = "skipped";
      asset.failureCode = "TASK_STATUS_UNCERTAIN";
      asset.failureMessage = "completion=uncertain，按正式规则不生成切片";
      asset.completedAt = new Date();
      return;
    }
    const target = taskSegmentTargetBounds({
      startMs: input.selectedStartMs,
      endMs: input.selectedEndMs,
      durationMs: input.durationMs,
    });
    asset.clipStartMs = target.clipStartMs;
    asset.clipEndMs = target.clipEndMs;
    asset.requestedStartMs = target.clipStartMs;
    asset.requestedEndMs = target.clipEndMs;
    asset.actualStartMs = null;
    asset.actualEndMs = null;
    asset.validationStatus = "pending";
    asset.validationFailureCode = null;
    asset.validationFailureMessage = null;
    if (target.tooShort) {
      asset.generationStatus = "skipped";
      asset.failureCode = "TASK_TOO_SHORT";
      asset.failureMessage = "精修或回退边界应用 500ms padding 后不足 3000ms";
      asset.completedAt = new Date();
      return;
    }
    asset.generationStatus = "queued";
  }
}
