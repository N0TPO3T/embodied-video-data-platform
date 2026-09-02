import { Inject, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { TaskSegmentAssetEntity } from "../database/entities/task-segment-asset.entity.js";
import { TaskBoundaryRefinementEntity } from "../database/entities/task-boundary-refinement.entity.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";

/**
 * SEG-DEC-006（决策 a）：结算完成后原视频清理/归档，长期只保留切片后的视频文件。
 * - 仅在全部 TaskSegmentAsset 为终态（ready/skipped）时执行，避免破坏仍在生成中的切片；
 * - 无切片资产的 Submission 保守跳过（保留原视频），避免误删无法恢复的来源；
 * - 对象删除后 submission 置 storageStatus=deleted（复用既有枚举），保留审计；
 * - 幂等：已删除的 Submission 直接返回。
 */
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
    const submission = await this.dataSource
      .getRepository(SubmissionEntity)
      .findOneBy({ id: input.submissionId });
    if (!submission) return "skipped";
    if (submission.storageStatus === "deleted") return "already_deleted";
    if (submission.storageStatus !== "available") return "skipped";

    const assets = await this.dataSource
      .getRepository(TaskSegmentAssetEntity)
      .findBy({ submissionId: input.submissionId });
    if (assets.length === 0) {
      await this.recordSkipped(submission, "NO_TASK_SEGMENT_ASSETS", "无任务切片资产，保留原视频");
      return "skipped";
    }
    const incomplete = assets.filter((asset) =>
      ["queued", "processing", "failed"].includes(asset.generationStatus),
    );
    if (incomplete.length > 0) {
      throw new RetryableSourceRetentionError(
        `存在未完成切片资产 ${incomplete.length} 个（${incomplete[0]?.generationStatus}），等待切片生成完成`,
      );
    }
    const refinements = await this.dataSource
      .getRepository(TaskBoundaryRefinementEntity)
      .findBy({ submissionId: input.submissionId });
    const incompleteRefinements = refinements.filter((refinement) =>
      ["queued", "running"].includes(refinement.executionStatus),
    );
    if (incompleteRefinements.length > 0) {
      throw new RetryableSourceRetentionError(
        `存在未完成边界精修 ${incompleteRefinements.length} 个（${incompleteRefinements[0]?.executionStatus}），等待精修完成或回退`,
      );
    }

    await this.storage.deleteObject({ objectKey: submission.objectKey });
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SubmissionEntity);
      const current = await repository.findOne({
        where: { id: input.submissionId },
        lock: { mode: "pessimistic_write" },
      });
      if (!current || current.storageStatus === "deleted") return;
      const now = new Date();
      current.storageStatus = "deleted";
      current.storageDeletedAt = now;
      current.storageDeletedByAccountId = SOURCE_RETENTION_ACTOR.id;
      current.storageDeletedByName = SOURCE_RETENTION_ACTOR.displayName;
      current.storageDeleteReason = `结算后仅保留切片视频文件：${input.reason}`;
      await repository.save(current);
      await this.audit.record(
        manager,
        SOURCE_RETENTION_ACTOR,
        "submission.source_archived",
        { id: current.id, name: current.originalFileName },
        "结算完成后清理原视频对象，仅保留切片后的视频文件",
        {
          storageStatus: "available",
          objectKey: current.objectKey,
          taskSegmentAssetCount: assets.length,
          reason: input.reason,
        },
        { storageStatus: "deleted", deletedAt: now.getTime(), archivedObjectKey: current.objectKey },
      );
    });
    return "archived";
  }

  private async recordSkipped(
    submission: SubmissionEntity,
    code: string,
    message: string,
  ): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.audit.record(
          manager,
          SOURCE_RETENTION_ACTOR,
          "submission.source_archive_skipped",
          { id: submission.id, name: submission.originalFileName },
          `${code}：${message}`,
          null,
          { code, message, reason: "settlement" },
        );
      });
    } catch {
      // 审计失败不阻塞归档判定
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
