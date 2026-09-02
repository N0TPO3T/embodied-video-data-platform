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
  TaskSegmentAssetEntity,
  type TaskSegmentMaterializationMode,
} from "../database/entities/task-segment-asset.entity.js";
import { acceptedAnnotationRun } from "../delivery/delivery-annotation.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import {
  TaskSegmentMediaTool,
  type TaskSegmentMediaMetadata,
  type TaskSegmentSourceMetadata,
} from "./task-segment-media.js";
import {
  planTaskSegmentMaterialization,
  validateTaskSegmentMaterialization,
  type TaskSegmentMaterializationPlan,
  type TaskSegmentMaterializationValidation,
  type TaskSegmentValidationFailureCode,
} from "./task-segment-materialization-planner.js";
import {
  MIN_CUT_BOUNDARY_TOLERANCE_MS,
  TASK_SEGMENT_MATERIALIZATION_POLICY_VERSION,
} from "./task-segment-materialization.policy.js";

export type TaskSegmentProcessOutcome =
  | "ready"
  | "failed"
  | "skipped"
  | "already_claimed";

export class RetryableTaskSegmentError extends Error {}

type InspectedClip = TaskSegmentMediaMetadata & { sha256: string };

type ValidatedCandidate = {
  mode: TaskSegmentMaterializationMode;
  path: string;
  inspected: InspectedClip;
  validation: TaskSegmentMaterializationValidation;
};

type CandidateFailure = {
  code:
    | TaskSegmentValidationFailureCode
    | "OUTPUT_HASH_FAILED"
    | "OUTPUT_DECODE_FAILED";
  message: string;
};

function safeErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return raw
    .replace(/data:[^\s]+/giu, "[data-url]")
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk|qwen)-[A-Za-z0-9_-]{8,}\b/gu, "[redacted]")
    .replace(/\/(?:private\/var|var\/folders|tmp|Users)\/[^\s:'"]+/gu, "[local-path]")
    .slice(0, 2_000);
}

function rawProbeHasAudio(rawProbe: Record<string, unknown>): boolean | null {
  const streams = rawProbe.streams;
  if (!Array.isArray(streams)) return null;
  return streams.some(
    (stream) =>
      stream &&
      typeof stream === "object" &&
      "codec_type" in stream &&
      stream.codec_type === "audio",
  );
}

@Injectable()
export class TaskSegmentProcessor {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    private readonly media: TaskSegmentMediaTool,
  ) {}

  async process(input: {
    assetId: string;
    recoverProcessing?: boolean;
  }): Promise<TaskSegmentProcessOutcome> {
    const claimed = await this.claim(
      input.assetId,
      input.recoverProcessing ?? false,
    );
    if (!claimed) return "already_claimed";
    const processingStartedAt = Date.now();
    let directory: string | null = null;
    try {
      const context = await this.loadContext(claimed);
      if (context.outcome) return context.outcome;
      const asset = context.asset;
      const objectKey = asset.clipObjectKey;
      if (!objectKey) {
        return await this.fail({
          assetId: asset.id,
          failureCode: "OUTPUT_UPLOAD_FAILED",
          failureMessage: "片段对象 Key 未锁定",
          retryable: true,
          processingStartedAt,
        });
      }

      directory = await mkdtemp(join(tmpdir(), "evdp-task-segment-"));
      await mkdir(directory, { recursive: true });
      const sourcePath = join(directory, "source-video");
      const canonicalPath = join(directory, "canonical-existing.mp4");

      const recovered = await this.recoverCanonicalIfPresent({
        asset,
        objectKey,
        canonicalPath,
        sourceHasAudio:
          asset.sourceHasAudio ?? rawProbeHasAudio(context.metadata.rawProbe),
        processingStartedAt,
      });
      if (recovered === "ready") return "ready";

      if (context.submission.storageStatus !== "available") {
        return await this.fail({
          assetId: asset.id,
          failureCode: "SOURCE_MEDIA_UNAVAILABLE",
          failureMessage: "原视频已不可用，未完成资产不能继续生成",
          retryable: false,
          processingStartedAt,
        });
      }
      try {
        await this.storage.headObject({ objectKey: asset.sourceObjectKey });
        await this.storage.downloadObject({
          objectKey: asset.sourceObjectKey,
          destinationPath: sourcePath,
        });
      } catch {
        return await this.fail({
          assetId: asset.id,
          failureCode: "SOURCE_MEDIA_UNAVAILABLE",
          failureMessage: "原视频对象无法读取",
          retryable: false,
          processingStartedAt,
        });
      }

      let source: TaskSegmentSourceMetadata;
      try {
        source = await this.media.inspectSource(sourcePath);
      } catch (error) {
        return await this.fail({
          assetId: asset.id,
          failureCode: "SOURCE_MEDIA_UNAVAILABLE",
          failureMessage: safeErrorMessage(error, "源视频媒体信息读取失败"),
          retryable: false,
          processingStartedAt,
        });
      }
      const keyframes = await this.media.keyframeIndex({
        sourcePath,
        sourceSha256: asset.sourceSha256,
        sourceDurationMs: source.durationMs,
      });
      const plan = planTaskSegmentMaterialization({
        requestedStartMs: asset.requestedStartMs,
        requestedEndMs: asset.requestedEndMs,
        sourceCodec: source.codec,
        sourceContainer: source.container,
        sourceNominalFps: source.nominalFps,
        keyframesMs: keyframes,
        timestampRisk: source.timestampRisk,
      });
      await this.persistPlan(asset.id, plan, source);

      let candidate: ValidatedCandidate | null = null;
      let copyRejectedReason: string | null =
        keyframes === null ? "KEYFRAME_INDEX_FAILED" : null;
      let streamCopyAttempted = false;
      const copyPath = join(directory, `task-${asset.id}-copy-candidate.mp4`);
      if (plan.preferredMode === "stream_copy") {
        streamCopyAttempted = true;
        try {
          await this.media.materializeByStreamCopy({
            sourcePath,
            outputPath: copyPath,
            requestedStartMs: asset.requestedStartMs,
            requestedEndMs: asset.requestedEndMs,
          });
          const checked = await this.inspectCandidate({
            mode: "stream_copy",
            path: copyPath,
            asset,
            sourceHasAudio: source.hasAudio,
            boundaryToleranceMs: plan.boundaryToleranceMs,
          });
          if ("candidate" in checked) {
            candidate = checked.candidate;
          } else {
            copyRejectedReason =
              checked.failure.code === "OUTPUT_DECODE_FAILED" ||
              checked.failure.code === "OUTPUT_HASH_FAILED" ||
              checked.failure.code === "OUTPUT_VIDEO_STREAM_MISSING"
                ? "STREAM_COPY_DECODE_FAILED"
                : checked.failure.code;
          }
        } catch {
          copyRejectedReason = "STREAM_COPY_FAILED";
        }
        if (!candidate) {
          await rm(copyPath, { force: true });
        }
      }

      if (!candidate) {
        await this.dataSource.getRepository(TaskSegmentAssetEntity).update(
          { id: asset.id, generationStatus: "processing" },
          {
            materializationMode: "exact_clip_transcode",
            streamCopyAttempted,
            copyRejectedReason,
            transcodedInputDurationMs:
              asset.requestedEndMs - asset.requestedStartMs,
          },
        );
        const exactPath = join(
          directory,
          `task-${asset.id}-exact-transcode.mp4`,
        );
        try {
          await this.media.materializeByExactTranscode({
            sourcePath,
            outputPath: exactPath,
            requestedStartMs: asset.requestedStartMs,
            requestedEndMs: asset.requestedEndMs,
          });
        } catch (error) {
          return await this.fail({
            assetId: asset.id,
            failureCode: "EXACT_TRANSCODE_FAILED",
            failureMessage: safeErrorMessage(error, "精确片段转码失败"),
            retryable: true,
            copyRejectedReason,
            streamCopyAttempted,
            processingStartedAt,
          });
        }
        const checked = await this.inspectCandidate({
          mode: "exact_clip_transcode",
          path: exactPath,
          asset,
          sourceHasAudio: source.hasAudio,
          boundaryToleranceMs: plan.boundaryToleranceMs,
        });
        if ("failure" in checked) {
          return await this.fail({
            assetId: asset.id,
            failureCode: checked.failure.code,
            failureMessage: checked.failure.message,
            retryable: true,
            copyRejectedReason,
            streamCopyAttempted,
            processingStartedAt,
          });
        }
        candidate = checked.candidate;
      }

      try {
        await this.storage.uploadObject({
          objectKey,
          sourcePath: candidate.path,
          contentType: "video/mp4",
        });
      } catch {
        return await this.fail({
          assetId: asset.id,
          failureCode: "OUTPUT_UPLOAD_FAILED",
          failureMessage: "通过校验的任务片段上传失败",
          retryable: true,
          copyRejectedReason,
          streamCopyAttempted,
          processingStartedAt,
        });
      }
      try {
        const uploaded = await this.storage.headObject({ objectKey });
        if (uploaded.sizeBytes !== candidate.inspected.sizeBytes) {
          throw new Error("uploaded size mismatch");
        }
      } catch {
        return await this.fail({
          assetId: asset.id,
          failureCode: "OUTPUT_OBJECT_VERIFY_FAILED",
          failureMessage: "上传后的任务片段对象大小校验失败",
          retryable: true,
          copyRejectedReason,
          streamCopyAttempted,
          processingStartedAt,
        });
      }

      try {
        await this.finalize({
          assetId: asset.id,
          candidate,
          copyRejectedReason,
          streamCopyAttempted,
          processingStartedAt,
        });
      } catch (error) {
        return await this.fail({
          assetId: asset.id,
          failureCode: "DATABASE_FINALIZE_FAILED",
          failureMessage: safeErrorMessage(error, "片段完成状态写入失败"),
          retryable: true,
          copyRejectedReason,
          streamCopyAttempted,
          processingStartedAt,
        });
      }
      return "ready";
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  private async claim(
    assetId: string,
    recoverProcessing: boolean,
  ): Promise<TaskSegmentAssetEntity | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TaskSegmentAssetEntity);
      const asset = await repository.findOne({
        where: { id: assetId },
        lock: { mode: "pessimistic_write" },
      });
      if (!asset) return null;
      if (asset.generationStatus === "ready" || asset.generationStatus === "skipped") {
        return null;
      }
      if (asset.generationStatus === "processing" && !recoverProcessing) return null;
      if (!["queued", "failed", "processing"].includes(asset.generationStatus)) {
        return null;
      }
      const now = new Date();
      asset.generationStatus = "processing";
      asset.attemptCount += 1;
      asset.failureCode = null;
      asset.failureMessage = null;
      asset.validationStatus = "pending";
      asset.validationFailureCode = null;
      asset.validationFailureMessage = null;
      asset.actualStartMs = null;
      asset.actualEndMs = null;
      asset.startDriftMs = null;
      asset.endDriftMs = null;
      asset.startedAt = now;
      asset.completedAt = null;
      asset.materializationStartedAt = now;
      asset.materializationCompletedAt = null;
      asset.materializationDurationMs = null;
      return repository.save(asset);
    });
  }

  private async loadContext(asset: TaskSegmentAssetEntity): Promise<{
    asset: TaskSegmentAssetEntity;
    submission: SubmissionEntity;
    metadata: MediaMetadataEntity;
    outcome: TaskSegmentProcessOutcome | null;
  }> {
    const [run, submission, metadata] = await Promise.all([
      this.dataSource.getRepository(AnnotationRunEntity).findOneBy({
        id: asset.annotationRunId,
      }),
      this.dataSource.getRepository(SubmissionEntity).findOneBy({
        id: asset.submissionId,
      }),
      this.dataSource.getRepository(MediaMetadataEntity).findOneBy({
        submissionId: asset.submissionId,
      }),
    ]);
    if (!run || !submission || !metadata || run.submissionId !== submission.id) {
      return {
        asset,
        submission: submission ?? new SubmissionEntity(),
        metadata: metadata ?? new MediaMetadataEntity(),
        outcome: await this.skip(
          asset.id,
          "SOURCE_MEDIA_UNAVAILABLE",
          "来源 Run、Submission 或媒体元数据不存在",
        ),
      };
    }
    const review =
      run.reviewRevision > 0
        ? await this.dataSource.getRepository(AnnotationReviewEntity).findOneBy({
            annotationRunId: run.id,
            revision: run.reviewRevision,
          })
        : null;
    if (!acceptedAnnotationRun(run, review)) {
      return {
        asset,
        submission,
        metadata,
        outcome: await this.skip(
          asset.id,
          "SOURCE_MEDIA_FINALIZED",
          "来源 Annotation Run 已不再是当前正式结果",
        ),
      };
    }
    if (
      asset.sourceObjectKey !== submission.objectKey ||
      asset.sourceSha256 !== submission.checksumSha256 ||
      asset.submissionId !== run.submissionId
    ) {
      return {
        asset,
        submission,
        metadata,
        outcome: await this.skip(
          asset.id,
          "SOURCE_MEDIA_FINALIZED",
          "资产来源快照与当前 Submission 不一致",
        ),
      };
    }
    const durationMs = Math.round(Number(metadata.durationSeconds) * 1_000);
    if (
      !Number.isFinite(asset.requestedStartMs) ||
      !Number.isFinite(asset.requestedEndMs) ||
      asset.requestedStartMs < 0 ||
      asset.requestedEndMs <= asset.requestedStartMs ||
      !Number.isFinite(durationMs) ||
      asset.requestedEndMs > durationMs
    ) {
      return {
        asset,
        submission,
        metadata,
        outcome: await this.skip(
          asset.id,
          "SOURCE_MEDIA_FINALIZED",
          "已确定的物理切片请求范围无效",
        ),
      };
    }
    return { asset, submission, metadata, outcome: null };
  }

  private async recoverCanonicalIfPresent(input: {
    asset: TaskSegmentAssetEntity;
    objectKey: string;
    canonicalPath: string;
    sourceHasAudio: boolean | null;
    processingStartedAt: number;
  }): Promise<"ready" | "missing_or_invalid"> {
    let expectedSize: string;
    try {
      expectedSize = (
        await this.storage.headObject({ objectKey: input.objectKey })
      ).sizeBytes;
      await this.storage.downloadObject({
        objectKey: input.objectKey,
        destinationPath: input.canonicalPath,
      });
    } catch {
      return "missing_or_invalid";
    }
    const checked = await this.inspectCandidate({
      mode: input.asset.materializationMode,
      path: input.canonicalPath,
      asset: input.asset,
      sourceHasAudio: input.sourceHasAudio ?? false,
      boundaryToleranceMs:
        input.asset.boundaryToleranceMs ?? MIN_CUT_BOUNDARY_TOLERANCE_MS,
    });
    if ("failure" in checked || checked.candidate.inspected.sizeBytes !== expectedSize) {
      return "missing_or_invalid";
    }
    await this.finalize({
      assetId: input.asset.id,
      candidate: checked.candidate,
      copyRejectedReason: input.asset.copyRejectedReason,
      streamCopyAttempted: input.asset.streamCopyAttempted,
      processingStartedAt: input.processingStartedAt,
    });
    return "ready";
  }

  private async inspectCandidate(input: {
    mode: TaskSegmentMaterializationMode;
    path: string;
    asset: TaskSegmentAssetEntity;
    sourceHasAudio: boolean;
    boundaryToleranceMs: number;
  }): Promise<{ candidate: ValidatedCandidate } | { failure: CandidateFailure }> {
    let inspected: InspectedClip;
    try {
      inspected = await this.media.inspect(input.path);
    } catch (error) {
      const message = safeErrorMessage(error, "输出文件探测或 SHA-256 失败");
      return {
        failure: {
          code: message.includes("no video stream")
            ? "OUTPUT_VIDEO_STREAM_MISSING"
            : "OUTPUT_HASH_FAILED",
          message,
        },
      };
    }
    try {
      await this.media.assertFullyDecodable(input.path);
    } catch {
      return {
        failure: {
          code: "OUTPUT_DECODE_FAILED",
          message: "输出任务片段无法完整解码",
        },
      };
    }
    const validation = validateTaskSegmentMaterialization({
      mode: input.mode,
      requestedStartMs: input.asset.requestedStartMs,
      requestedEndMs: input.asset.requestedEndMs,
      boundaryToleranceMs: input.boundaryToleranceMs,
      sourceHasAudio: input.sourceHasAudio,
      output: inspected,
    });
    if (validation.status === "failed") {
      return {
        failure: {
          code: validation.failureCode!,
          message: validation.failureMessage!,
        },
      };
    }
    return {
      candidate: {
        mode: input.mode,
        path: input.path,
        inspected,
        validation,
      },
    };
  }

  private async persistPlan(
    assetId: string,
    plan: TaskSegmentMaterializationPlan,
    source: TaskSegmentSourceMetadata,
  ): Promise<void> {
    await this.dataSource.getRepository(TaskSegmentAssetEntity).update(
      { id: assetId, generationStatus: "processing" },
      {
        materializationPolicyVersion:
          TASK_SEGMENT_MATERIALIZATION_POLICY_VERSION,
        materializationMode: plan.preferredMode,
        sourceCodec: source.codec,
        sourceNominalFps: source.nominalFps,
        sourceHasAudio: source.hasAudio,
        sourceDurationMs: source.durationMs,
        requestedDurationMs: plan.requestedEndMs - plan.requestedStartMs,
        predictedCopyStartMs: plan.previousKeyframeMs,
        keyframeDistanceStartMs: plan.keyframeDistanceStartMs,
        boundaryToleranceMs: plan.boundaryToleranceMs,
        transcodedInputDurationMs:
          plan.preferredMode === "exact_clip_transcode"
            ? plan.requestedEndMs - plan.requestedStartMs
            : null,
      },
    );
  }

  private async finalize(input: {
    assetId: string;
    candidate: ValidatedCandidate;
    copyRejectedReason: string | null;
    streamCopyAttempted: boolean;
    processingStartedAt: number;
  }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TaskSegmentAssetEntity);
      const asset = await repository.findOne({
        where: { id: input.assetId },
        lock: { mode: "pessimistic_write" },
      });
      if (!asset) throw new Error("任务片段资产不存在");
      if (asset.generationStatus === "ready" && asset.validationStatus === "passed") {
        return;
      }
      if (asset.generationStatus !== "processing") {
        throw new Error(`任务片段状态不允许完成：${asset.generationStatus}`);
      }
      const completedAt = new Date();
      asset.materializationPolicyVersion =
        TASK_SEGMENT_MATERIALIZATION_POLICY_VERSION;
      asset.materializationMode = input.candidate.mode;
      asset.streamCopyAttempted = input.streamCopyAttempted;
      asset.copyRejectedReason = input.copyRejectedReason;
      asset.transcodedInputDurationMs =
        input.candidate.mode === "exact_clip_transcode"
          ? asset.requestedEndMs - asset.requestedStartMs
          : null;
      asset.clipSha256 = input.candidate.inspected.sha256;
      asset.clipSizeBytes = input.candidate.inspected.sizeBytes;
      asset.actualStartMs = input.candidate.validation.actualStartMs;
      asset.actualEndMs = input.candidate.validation.actualEndMs;
      asset.startDriftMs = input.candidate.validation.startDriftMs;
      asset.endDriftMs = input.candidate.validation.endDriftMs;
      // Keep legacy API fields as the canonical file's actual source interval.
      asset.clipStartMs = input.candidate.validation.actualStartMs;
      asset.clipEndMs = input.candidate.validation.actualEndMs;
      asset.clipDurationMs = Math.round(input.candidate.inspected.durationMs);
      asset.codec = input.candidate.inspected.codec;
      asset.width = input.candidate.inspected.width;
      asset.height = input.candidate.inspected.height;
      asset.frameRate = input.candidate.inspected.frameRate;
      asset.hasAudio = input.candidate.inspected.hasAudio;
      asset.validationStatus = "passed";
      asset.validationFailureCode = null;
      asset.validationFailureMessage = null;
      asset.generationStatus = "ready";
      asset.failureCode = null;
      asset.failureMessage = null;
      asset.materializationCompletedAt = completedAt;
      asset.materializationDurationMs = Math.max(
        0,
        completedAt.getTime() - input.processingStartedAt,
      );
      asset.completedAt = completedAt;
      await repository.save(asset);
    });
  }

  private async skip(
    assetId: string,
    failureCode: string,
    failureMessage: string,
  ): Promise<"skipped"> {
    await this.dataSource.getRepository(TaskSegmentAssetEntity).update(
      { id: assetId, generationStatus: "processing" },
      {
        generationStatus: "skipped",
        validationStatus: "failed",
        validationFailureCode: failureCode,
        validationFailureMessage: failureMessage.slice(0, 2_000),
        failureCode,
        failureMessage: failureMessage.slice(0, 2_000),
        materializationCompletedAt: new Date(),
        completedAt: new Date(),
      },
    );
    return "skipped";
  }

  private async fail(input: {
    assetId: string;
    failureCode: string;
    failureMessage: string;
    retryable: boolean;
    processingStartedAt: number;
    copyRejectedReason?: string | null;
    streamCopyAttempted?: boolean;
  }): Promise<"failed"> {
    const completedAt = new Date();
    const failureMessage = safeErrorMessage(
      input.failureMessage,
      "任务片段生成失败",
    );
    try {
      await this.dataSource.getRepository(TaskSegmentAssetEntity).update(
        { id: input.assetId, generationStatus: "processing" },
        {
          generationStatus: "failed",
          validationStatus: "failed",
          validationFailureCode: input.failureCode,
          validationFailureMessage: failureMessage,
          failureCode: input.failureCode,
          failureMessage,
          copyRejectedReason: input.copyRejectedReason,
          streamCopyAttempted: input.streamCopyAttempted,
          materializationCompletedAt: completedAt,
          materializationDurationMs: Math.max(
            0,
            completedAt.getTime() - input.processingStartedAt,
          ),
          completedAt,
        },
      );
    } catch (error) {
      throw new RetryableTaskSegmentError(
        `DATABASE_FINALIZE_FAILED: ${safeErrorMessage(error, "失败状态写入失败")}`,
      );
    }
    if (input.retryable) {
      throw new RetryableTaskSegmentError(
        `${input.failureCode}: ${failureMessage}`,
      );
    }
    return "failed";
  }
}
