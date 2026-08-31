import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Inject, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

import { AnnotationReviewEntity } from "../database/entities/annotation-review.entity.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { TaskSegmentAssetEntity } from "../database/entities/task-segment-asset.entity.js";
import { acceptedAnnotationRun } from "../delivery/delivery-annotation.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import {
  TaskSegmentMediaTool,
  type TaskSegmentMediaMetadata,
} from "./task-segment-media.js";

export type TaskSegmentProcessOutcome = "ready" | "failed" | "skipped" | "already_claimed";

export class RetryableTaskSegmentError extends Error {}

type InspectedClip = TaskSegmentMediaMetadata & { sha256: string };

function errorMessage(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : fallback).slice(0, 2_000);
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
    const asset = await this.claim(input.assetId, input.recoverProcessing ?? false);
    if (!asset) return "already_claimed";
    let directory: string | null = null;
    try {
      const source = await this.loadAndValidateSource(asset);
      if (source.outcome) return source.outcome;
      const sourceDurationMs = source.durationMs;
      directory = await mkdtemp(join(tmpdir(), "evdp-task-segment-"));
      await mkdir(directory, { recursive: true });
      const sourcePath = join(directory, "source-video");
      const clipPath = join(directory, "task-segment.mp4");
      const objectKey = asset.clipObjectKey;
      if (!objectKey) {
        return await this.fail(asset.id, "DATABASE_FINALIZE_FAILED", "片段对象 Key 未锁定", true);
      }

      let inspected: InspectedClip | null = null;
      let existingSize: string | null = null;
      try {
        const existing = await this.storage.headObject({ objectKey });
        existingSize = existing.sizeBytes;
      } catch {
        // A missing derived object is the normal first-attempt path.
      }
      if (existingSize !== null) {
        try {
          await this.storage.downloadObject({ objectKey, destinationPath: clipPath });
        } catch (error) {
          return await this.fail(
            asset.id,
            "SOURCE_DOWNLOAD_FAILED",
            `已上传片段恢复下载失败：${errorMessage(error, "对象存储下载失败")}`,
            true,
          );
        }
        inspected = await this.inspect(asset, clipPath, sourceDurationMs);
        if (!inspected) return "failed";
        if (existingSize !== inspected.sizeBytes) {
          return await this.fail(
            asset.id,
            "STORAGE_UPLOAD_FAILED",
            "对象存储中的片段大小与本地探测结果不一致",
            true,
          );
        }
      } else {
        try {
          await this.storage.headObject({ objectKey: asset.sourceObjectKey });
        } catch (error) {
          return await this.fail(
            asset.id,
            "SOURCE_OBJECT_UNAVAILABLE",
            errorMessage(error, "原视频对象不可用"),
            false,
          );
        }
        try {
          await this.storage.downloadObject({
            objectKey: asset.sourceObjectKey,
            destinationPath: sourcePath,
          });
        } catch (error) {
          return await this.fail(
            asset.id,
            "SOURCE_DOWNLOAD_FAILED",
            errorMessage(error, "原视频下载失败"),
            true,
          );
        }
        try {
          await this.media.transcode({
            sourcePath,
            outputPath: clipPath,
            startMs: asset.clipStartMs,
            endMs: asset.clipEndMs,
          });
        } catch (error) {
          return await this.fail(
            asset.id,
            "FFMPEG_FAILED",
            errorMessage(error, "FFmpeg 切片失败"),
            false,
          );
        }
        inspected = await this.inspect(asset, clipPath, sourceDurationMs);
        if (!inspected) return "failed";
        try {
          await this.storage.uploadObject({
            objectKey,
            sourcePath: clipPath,
            contentType: "video/mp4",
          });
          const uploaded = await this.storage.headObject({ objectKey });
          if (uploaded.sizeBytes !== inspected.sizeBytes) {
            throw new Error("上传后的对象大小与切片文件不一致");
          }
        } catch (error) {
          return await this.fail(
            asset.id,
            "STORAGE_UPLOAD_FAILED",
            errorMessage(error, "片段上传失败"),
            true,
          );
        }
      }

      try {
        await this.finalize(asset.id, inspected);
        return "ready";
      } catch (error) {
        return await this.fail(
          asset.id,
          "DATABASE_FINALIZE_FAILED",
          errorMessage(error, "片段数据库完成状态写入失败"),
          true,
        );
      }
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
      if (!["queued", "failed", "processing"].includes(asset.generationStatus)) return null;
      asset.generationStatus = "processing";
      asset.attemptCount += 1;
      asset.failureCode = null;
      asset.failureMessage = null;
      asset.startedAt = new Date();
      asset.completedAt = null;
      return repository.save(asset);
    });
  }

  private async loadAndValidateSource(asset: TaskSegmentAssetEntity): Promise<{
    outcome: TaskSegmentProcessOutcome | null;
    durationMs: number | null;
  }> {
    const [run, submission, metadata] = await Promise.all([
      this.dataSource.getRepository(AnnotationRunEntity).findOneBy({ id: asset.annotationRunId }),
      this.dataSource.getRepository(SubmissionEntity).findOneBy({ id: asset.submissionId }),
      this.dataSource.getRepository(MediaMetadataEntity).findOneBy({ submissionId: asset.submissionId }),
    ]);
    if (!run || !submission || !metadata || run.submissionId !== submission.id) {
      return {
        outcome: await this.skip(asset.id, "SOURCE_OBJECT_UNAVAILABLE", "来源 Run、Submission 或媒体元数据不存在"),
        durationMs: null,
      };
    }
    const review = run.reviewRevision > 0
      ? await this.dataSource.getRepository(AnnotationReviewEntity).findOneBy({
          annotationRunId: run.id,
          revision: run.reviewRevision,
        })
      : null;
    if (!acceptedAnnotationRun(run, review)) {
      return {
        outcome: await this.skip(asset.id, "ANNOTATION_RUN_NOT_PUBLISHED", "来源 Annotation Run 已不再是正式结果"),
        durationMs: null,
      };
    }
    if (
      asset.sourceObjectKey !== submission.objectKey ||
      asset.sourceSha256 !== submission.checksumSha256 ||
      asset.submissionId !== run.submissionId
    ) {
      return {
        outcome: await this.skip(asset.id, "SOURCE_OBJECT_UNAVAILABLE", "资产来源快照与 Submission 不一致"),
        durationMs: null,
      };
    }
    if (submission.uploadStatus !== "uploaded" || submission.storageStatus !== "available") {
      return {
        outcome: await this.skip(asset.id, "SOURCE_OBJECT_UNAVAILABLE", "原视频对象当前不可用"),
        durationMs: null,
      };
    }
    const durationMs = Math.round(Number(metadata.durationSeconds) * 1_000);
    if (
      !Number.isFinite(asset.clipStartMs) ||
      !Number.isFinite(asset.clipEndMs) ||
      asset.clipStartMs < 0 ||
      asset.clipEndMs <= asset.clipStartMs
    ) {
      return {
        outcome: await this.skip(asset.id, "INVALID_TIME_RANGE", "任务切片时间区间无效"),
        durationMs: null,
      };
    }
    if (!Number.isFinite(durationMs) || asset.clipEndMs > durationMs) {
      return {
        outcome: await this.skip(asset.id, "END_EXCEEDS_SOURCE_DURATION", "任务结束时间超过原视频时长"),
        durationMs: null,
      };
    }
    return { outcome: null, durationMs };
  }

  private async inspect(
    asset: TaskSegmentAssetEntity,
    clipPath: string,
    sourceDurationMs: number | null,
  ): Promise<InspectedClip | null> {
    let inspected: InspectedClip;
    try {
      inspected = await this.media.inspect(clipPath);
    } catch (error) {
      await this.fail(
        asset.id,
        "FFPROBE_FAILED",
        errorMessage(error, "FFprobe、文件大小或 SHA-256 校验失败"),
        false,
      );
      return null;
    }
    // 正式规则（SEG-DEC-009）：stream copy 按关键帧对齐，实际起点只可能
    // 早于目标起点（对齐到目标前最近关键帧），实际终点以 -to 绝对截止为准。
    // 校验范围合法性，不要求与目标逐帧一致；实际边界在 finalize 中写回。
    const toleranceMs = Math.max(250, 1_000 / inspected.frameRate);
    if (
      !Number.isFinite(inspected.startMs) ||
      inspected.startMs < 0 ||
      inspected.startMs > asset.clipStartMs + toleranceMs
    ) {
      await this.fail(
        asset.id,
        "FFPROBE_FAILED",
        `实际起点 ${inspected.startMs}ms 不在目标起点 ${asset.clipStartMs}ms 附近（关键帧对齐）`,
        false,
      );
      return null;
    }
    const actualEndMs = inspected.startMs + inspected.durationMs;
    if (sourceDurationMs !== null && actualEndMs > sourceDurationMs + toleranceMs) {
      await this.fail(
        asset.id,
        "FFPROBE_FAILED",
        `实际结束 ${actualEndMs}ms 超过原视频时长 ${sourceDurationMs}ms`,
        false,
      );
      return null;
    }
    return inspected;
  }

  private async finalize(assetId: string, inspected: InspectedClip): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TaskSegmentAssetEntity);
      const asset = await repository.findOne({
        where: { id: assetId },
        lock: { mode: "pessimistic_write" },
      });
      if (!asset) throw new Error("任务片段资产不存在");
      if (asset.generationStatus === "ready") return;
      if (asset.generationStatus !== "processing") {
        throw new Error(`任务片段状态不允许完成：${asset.generationStatus}`);
      }
      asset.clipSha256 = inspected.sha256;
      asset.clipSizeBytes = inspected.sizeBytes;
      // stream copy 关键帧对齐后的实际边界（SEG-DEC-009 决策 a）
      asset.clipStartMs = inspected.startMs;
      asset.clipEndMs = inspected.startMs + inspected.durationMs;
      asset.clipDurationMs = inspected.durationMs;
      asset.codec = inspected.codec;
      asset.width = inspected.width;
      asset.height = inspected.height;
      asset.frameRate = inspected.frameRate;
      asset.hasAudio = inspected.hasAudio;
      asset.generationStatus = "ready";
      asset.failureCode = null;
      asset.failureMessage = null;
      asset.completedAt = new Date();
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
        failureCode,
        failureMessage: failureMessage.slice(0, 2_000),
        completedAt: new Date(),
      },
    );
    return "skipped";
  }

  private async fail(
    assetId: string,
    failureCode: string,
    failureMessage: string,
    retryable: boolean,
  ): Promise<"failed"> {
    try {
      await this.dataSource.getRepository(TaskSegmentAssetEntity).update(
        { id: assetId, generationStatus: "processing" },
        {
          generationStatus: "failed",
          failureCode,
          failureMessage: failureMessage.slice(0, 2_000),
          completedAt: new Date(),
        },
      );
    } catch (error) {
      throw new RetryableTaskSegmentError(
        `DATABASE_FINALIZE_FAILED: ${errorMessage(error, "失败状态写入失败")}`,
      );
    }
    if (retryable) {
      throw new RetryableTaskSegmentError(`${failureCode}: ${failureMessage}`);
    }
    return "failed";
  }
}
