import { Inject, Injectable } from "@nestjs/common";
import { DataSource, In, type EntityManager } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { TaskSegmentAnnotationRevisionEntity } from "../database/entities/task-segment-annotation-revision.entity.js";
import { TaskBoundaryRefinementEntity } from "../database/entities/task-boundary-refinement.entity.js";
import { TaskSegmentAssetEntity } from "../database/entities/task-segment-asset.entity.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";

const ALLOWED_SKIPPED_REASONS = new Set([
  "TASK_STATUS_UNCERTAIN",
  "TASK_TOO_SHORT",
]);

function formalTaskCount(run: AnnotationRunEntity): number | null {
  const result =
    run.reviewStatus === "accepted_corrected"
      ? run.humanResult
      : run.normalizedResult;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const effective = result.effective;
  if (!effective || typeof effective !== "object" || Array.isArray(effective)) {
    return null;
  }
  const tasks = (effective as Record<string, unknown>).tasks;
  return Array.isArray(tasks) ? tasks.length : null;
}

@Injectable()
export class SourceRetentionProcessor {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    private readonly audit: AuditService,
  ) {}

  async process(input: {
    submissionId: string;
    reason: string;
  }): Promise<"archived" | "skipped" | "already_deleted"> {
    return this.dataSource.transaction(async (manager) => {
      const submission = await manager.getRepository(SubmissionEntity).findOne({
        where: { id: input.submissionId },
        lock: { mode: "pessimistic_write" },
      });
      if (!submission) return "skipped";
      if (submission.storageStatus === "deleted") return "already_deleted";
      if (submission.storageStatus !== "available") return "skipped";

      const formalRuns = await manager.getRepository(AnnotationRunEntity).find({
        where: {
          submissionId: input.submissionId,
          executionStatus: "succeeded",
          publicationStatus: In(["auto_accepted", "human_verified"]),
        },
        lock: { mode: "pessimistic_write" },
      });
      if (formalRuns.length !== 1) {
        await this.recordSkipped(
          manager,
          submission,
          "CURRENT_FORMAL_RUN_UNAVAILABLE",
          formalRuns.length === 0
            ? "不存在当前正式 Annotation Run，保留原视频"
            : "存在多个当前正式 Annotation Run，保留原视频",
        );
        return "skipped";
      }
      const formalRun = formalRuns[0]!;
      const assets = await manager.getRepository(TaskSegmentAssetEntity).find({
        where: { annotationRunId: formalRun.id },
        lock: { mode: "pessimistic_write" },
      });
      if (assets.length === 0) {
        await this.recordSkipped(
          manager,
          submission,
          "NO_TASK_SEGMENT_ASSETS",
          "当前正式 Run 无任务切片资产，保留原视频",
        );
        return "skipped";
      }
      const expectedTaskCount = formalTaskCount(formalRun);
      const assetTaskIndexes = new Set(assets.map((asset) => asset.taskIndex));
      if (
        expectedTaskCount === null ||
        assets.length !== expectedTaskCount ||
        assetTaskIndexes.size !== expectedTaskCount ||
        [...assetTaskIndexes].some(
          (taskIndex) => taskIndex < 0 || taskIndex >= expectedTaskCount,
        )
      ) {
        throw new RetryableSourceRetentionError(
          "当前正式 Annotation Run 的任务与 TaskSegmentAsset 不完整对应，禁止删除原视频",
        );
      }

      const refinements = await manager
        .getRepository(TaskBoundaryRefinementEntity)
        .find({
          where: { annotationRunId: formalRun.id },
          lock: { mode: "pessimistic_write" },
        });
      const incompleteRefinement = refinements.find((refinement) =>
        ["queued", "running"].includes(refinement.executionStatus),
      );
      if (incompleteRefinement) {
        throw new RetryableSourceRetentionError(
          `边界精修仍为 ${incompleteRefinement.executionStatus}，禁止删除原视频`,
        );
      }

      const inFlight = assets.find((asset) =>
        ["queued", "processing", "failed"].includes(asset.generationStatus),
      );
      if (inFlight) {
        throw new RetryableSourceRetentionError(
          `任务片段 ${inFlight.id} 为 ${inFlight.generationStatus}，禁止删除原视频`,
        );
      }
      const invalidSkipped = assets.find(
        (asset) =>
          asset.generationStatus === "skipped" &&
          (!asset.failureCode || !ALLOWED_SKIPPED_REASONS.has(asset.failureCode)),
      );
      if (invalidSkipped) {
        throw new RetryableSourceRetentionError(
          `任务片段 ${invalidSkipped.id} 的 skipped 原因不允许删除原视频`,
        );
      }
      const readyAssets = assets.filter(
        (asset) => asset.generationStatus === "ready",
      );
      if (readyAssets.length === 0) {
        await this.recordSkipped(
          manager,
          submission,
          "NO_VALIDATED_READY_ASSETS",
          "没有 ready + validation passed 的任务片段，保留原视频",
        );
        return "skipped";
      }
      for (const asset of readyAssets) {
        if (
          asset.validationStatus !== "passed" ||
          !asset.clipObjectKey ||
          !asset.clipSizeBytes ||
          !asset.clipSha256?.match(/^[a-f0-9]{64}$/u)
        ) {
          throw new RetryableSourceRetentionError(
            `任务片段 ${asset.id} 未完成新 materialization validation，禁止删除原视频`,
          );
        }
        let objectSize: string;
        try {
          objectSize = (
            await this.storage.headObject({ objectKey: asset.clipObjectKey })
          ).sizeBytes;
        } catch {
          throw new RetryableSourceRetentionError(
            `任务片段 ${asset.id} 的最终对象无法 HEAD 校验，禁止删除原视频`,
          );
        }
        if (objectSize !== asset.clipSizeBytes) {
          throw new RetryableSourceRetentionError(
            `任务片段 ${asset.id} 的最终对象大小不匹配，禁止删除原视频`,
          );
        }
        if (asset.annotationPublicationStatus !== "published" || !asset.currentAnnotationRevisionId) {
          throw new RetryableSourceRetentionError(`任务片段 ${asset.id} 的 JSON 尚未成对发布，禁止删除原视频`);
        }
        const revision = await manager.getRepository(TaskSegmentAnnotationRevisionEntity).findOne({
          where: { id: asset.currentAnnotationRevisionId, taskSegmentAssetId: asset.id },
          lock: { mode: "pessimistic_write" },
        });
        if (!revision || revision.publicationStatus !== "published" || revision.videoSha256 !== asset.clipSha256 ||
            !revision.jsonObjectKey || !revision.jsonSha256.match(/^[a-f0-9]{64}$/u) || Number(revision.jsonSizeBytes) <= 0) {
          throw new RetryableSourceRetentionError(`任务片段 ${asset.id} 的当前 JSON 绑定无效，禁止删除原视频`);
        }
        try {
          const json = await this.storage.headObject({ objectKey: revision.jsonObjectKey });
          if (json.sizeBytes !== revision.jsonSizeBytes) throw new Error("size mismatch");
        } catch {
          throw new RetryableSourceRetentionError(`任务片段 ${asset.id} 的 JSON 对象校验失败，禁止删除原视频`);
        }
      }

      const metadata = await manager.getRepository(MediaMetadataEntity).findOneBy({ submissionId: submission.id });
      const derivedKeys = [...new Set([
        metadata?.thumbnailObjectKey, metadata?.previewObjectKey,
        metadata?.hlsMasterObjectKey, ...(metadata?.hlsObjectKeys ?? []),
      ].filter((key): key is string => Boolean(key) && key !== submission.objectKey))];
      const deletedObjectKeys = [...derivedKeys, submission.objectKey];
      try {
        // Last recovery source is deleted last. On partial failure the database
        // transaction rolls back; idempotent object deletes resume on retry.
        for (const objectKey of deletedObjectKeys) await this.storage.deleteObject({ objectKey });
      } catch {
        throw new RetryableSourceRetentionError("源视频及完整预览对象清理未完成，需要重试");
      }
      const now = new Date();
      submission.storageStatus = "deleted";
      submission.storageDeletedAt = now;
      submission.storageDeletedByAccountId = SOURCE_RETENTION_ACTOR.id;
      submission.storageDeletedByName = SOURCE_RETENTION_ACTOR.displayName;
      submission.storageDeleteReason = `结算后仅保留通过校验的任务片段：${input.reason}`;
      await manager.getRepository(SubmissionEntity).save(submission);
      await this.audit.record(
        manager,
        SOURCE_RETENTION_ACTOR,
        "submission.source_archived",
        { id: submission.id, name: submission.originalFileName },
        "所有必要任务片段均 ready + validation passed 后清理原视频",
        {
          storageStatus: "available",
          objectKey: submission.objectKey,
          formalAnnotationRunId: formalRun.id,
          taskSegmentAssetCount: assets.length,
          validatedReadyAssetCount: readyAssets.length,
          reason: input.reason,
        },
        {
          storageStatus: "deleted",
          deletedAt: now.getTime(),
          archivedObjectKey: submission.objectKey,
          deletedObjectKeys,
          formalAnnotationRunId: formalRun.id,
          taskSegmentAssetIds: readyAssets.map(asset => asset.id),
          annotationRevisionIds: readyAssets.map(asset => asset.currentAnnotationRevisionId),
          sourceSha256: submission.checksumSha256,
          reason: input.reason,
        },
      );
      return "archived";
    });
  }

  private async recordSkipped(
    manager: EntityManager,
    submission: SubmissionEntity,
    code: string,
    message: string,
  ): Promise<void> {
    try {
      await this.audit.record(
        manager,
        SOURCE_RETENTION_ACTOR,
        "submission.source_archive_skipped",
        { id: submission.id, name: submission.originalFileName },
        `${code}：${message}`,
        null,
        { code, message, reason: "settlement" },
      );
    } catch {
      // Audit failure does not relax the conservative retention decision.
    }
  }
}

export class RetryableSourceRetentionError extends Error {}

const SOURCE_RETENTION_ACTOR = {
  id: "system-task-segment-retention",
  displayName: "任务切片源视频归档 Worker",
  username: "task-segment-retention-worker",
  role: "admin",
  status: "active",
  updatedAt: 0,
} as const;
