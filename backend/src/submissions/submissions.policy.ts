import { Injectable } from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import type { SubmissionEntity } from "../database/entities/submission.entity.js";
import { SubmissionFailure } from "./submission-failure.js";

@Injectable()
export class SubmissionsPolicy {
  requireCreate(actor: PublicUser): asserts actor is PublicUser & {
    role: "collector";
    teamId: string;
  } {
    if (actor.role !== "collector" || !actor.teamId) {
      throw new SubmissionFailure(
        "FORBIDDEN",
        "仅数采账号可以上传视频",
        403,
      );
    }
  }

  requireRead(actor: PublicUser, submission: SubmissionEntity): void {
    if (actor.role === "admin") return;
    if (actor.role === "leader" && actor.teamId === submission.teamId) {
      return;
    }
    if (actor.role === "collector" && actor.id === submission.ownerId) {
      return;
    }
    throw new SubmissionFailure("FORBIDDEN", "无权查看该视频", 403);
  }

  requireUploadControl(
    actor: PublicUser,
    submission: SubmissionEntity,
  ): void {
    if (actor.role === "collector" && actor.id === submission.ownerId) {
      return;
    }
    if (actor.role === "admin") return;
    throw new SubmissionFailure("FORBIDDEN", "无权操作该上传", 403);
  }

  requireQualityReview(
    actor: PublicUser,
    submission: SubmissionEntity,
  ): void {
    if (actor.role === "admin") return;
    if (actor.role === "leader" && actor.teamId === submission.teamId) {
      return;
    }
    throw new SubmissionFailure("FORBIDDEN", "无权复核该视频", 403);
  }

  requireAiQualityRerun(actor: PublicUser): void {
    if (actor.role === "admin") return;
    throw new SubmissionFailure(
      "FORBIDDEN",
      "仅管理员可重跑 AI 质检",
      403,
    );
  }

  requireSubmissionRename(actor: PublicUser): void {
    if (actor.role === "admin") return;
    throw new SubmissionFailure(
      "FORBIDDEN",
      "仅管理员可重命名提交数据",
      403,
    );
  }

  requireSubmissionDelete(actor: PublicUser): void {
    if (actor.role === "admin") return;
    throw new SubmissionFailure(
      "FORBIDDEN",
      "仅管理员可删除提交数据",
      403,
    );
  }

  requireStorageDelete(actor: PublicUser): void {
    if (actor.role === "admin") return;
    throw new SubmissionFailure(
      "FORBIDDEN",
      "仅管理员可删除视频对象",
      403,
    );
  }

  requireDuplicateCandidateReview(actor: PublicUser): void {
    if (actor.role === "admin") return;
    throw new SubmissionFailure(
      "FORBIDDEN",
      "仅管理员可处理近似重复候选",
      403,
    );
  }
}
