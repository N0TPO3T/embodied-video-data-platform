import { resolve } from "node:path";

import type { DataSource } from "typeorm";
import { vi } from "vitest";

import type { PublicUser } from "../src/auth/auth.types.js";
import { createDataSource } from "../src/database/data-source.js";
import { AnnotationCorrectionEntity } from "../src/database/entities/annotation-correction.entity.js";
import { AnnotationReviewEntity } from "../src/database/entities/annotation-review.entity.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { JobOutboxEntity } from "../src/database/entities/job-outbox.entity.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";
import { AnnotationManagementService } from "../src/video-annotation/annotation-management.service.js";
import { loadVideoAnnotationPrompt } from "../src/video-annotation/prompt-loader.js";
import {
  normalizeVideoAnnotation,
  parseRawVideoAnnotation,
} from "../src/video-annotation/video-annotation.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

describe("annotation management", () => {
  let dataSource: DataSource;
  let service: AnnotationManagementService;
  const actor: PublicUser = {
    id: "U-AN-ADMIN",
    displayName: "标注管理员",
    username: "annotation-admin",
    role: "admin",
    status: "active",
    updatedAt: 0,
  };

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-AN",
      name: "标注测试团队",
    });
    await dataSource.getRepository(UserEntity).save([
      {
        id: actor.id,
        displayName: actor.displayName,
        username: actor.username,
        usernameNormalized: actor.username,
        passwordHash: "not-used",
        role: "admin",
        status: "active",
      },
      {
        id: "U-AN-COLLECTOR",
        displayName: "标注数采",
        username: "annotation-collector",
        usernameNormalized: "annotation-collector",
        passwordHash: "not-used",
        role: "collector",
        teamId: "TEAM-AN",
        status: "active",
      },
    ]);
    await dataSource.getRepository(SubmissionEntity).save({
      id: "SUB-AN",
      ownerId: "U-AN-COLLECTOR",
      teamId: "TEAM-AN",
      originalFileName: "annotation.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "1000",
      checksumSha256: "a".repeat(64),
      objectKey: "uploads/annotation.mp4",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      storageStatus: "available",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: "SUB-AN",
      durationSeconds: "15.000",
      width: 1920,
      height: 1080,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: "1000",
      rawProbe: {},
    });
    service = new AnnotationManagementService(dataSource, {
      record: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("stores an immutable field correction without changing quality state", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    const raw = parseRawVideoAnnotation({
      ...prompt.outputExample,
      video_id: "SUB-AN",
    });
    const candidate = normalizeVideoAnnotation({
      raw,
      frames: [0, 5_000, 10_000, 15_000].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,",
      })),
      durationMs: 15_000,
      promptVersion: prompt.promptVersion,
      promptContentSha256: prompt.contentSha256,
      model: prompt.model,
      requestId: "REQ-AN",
      modelDurationMs: 10,
      applySparseEvidencePolicy: false,
      enabledLabels: [],
    });
    expect(candidate.validation.errors).toEqual([]);
    await dataSource.getRepository(AnnotationRunEntity).save({
      id: "ANR-INITIAL",
      submissionId: "SUB-AN",
      trigger: "initial",
      pipelineVersion: "ego_video_annotation_pipeline_v1",
      schemaVersion: "ego_video_annotation_v2",
      evidencePolicyVersion: "ego_annotation_evidence_policy_v2",
      promptVersion: prompt.promptVersion,
      promptContentSha256: prompt.contentSha256,
      systemPromptSnapshot: prompt.systemPrompt,
      outputExampleSnapshot: prompt.outputExample,
      model: prompt.model,
      labelSetSnapshot: { id: "LSV-TEST", revision: 1, version: "test", labels: [] },
      executionStatus: "succeeded",
      reviewStatus: "pending",
      publicationStatus: "candidate_only",
      attemptCount: 1,
      reviewRevision: 0,
      rawResult: raw,
      normalizedResult: candidate,
      sourceTimestampsMs: [0, 5_000, 10_000, 15_000],
      queuedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
    });
    const corrected = { ...raw, video_summary: "人工逐字段核验后的摘要" };

    await expect(
      service.review(actor, "ANR-INITIAL", {
        expectedReviewRevision: 0,
        disposition: "accepted_corrected",
        reviewedFields: ["video_summary"],
        reasonCodes: ["SEMANTIC_ERROR"],
        reviewDurationMs: 100,
        reason: "伪造的目标类型不应进入纠错数据",
        correctedResult: corrected,
        corrections: [
          {
            targetType: "scene",
            targetId: "scene",
            fieldPath: "video_summary",
            reasonCode: "SEMANTIC_ERROR",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "ANNOTATION_CORRECTION_TARGET_INVALID" });

    const result = await service.review(actor, "ANR-INITIAL", {
      expectedReviewRevision: 0,
      disposition: "accepted_corrected",
      reviewedFields: ["video_summary", "scene.coarse_label"],
      reasonCodes: ["SEMANTIC_ERROR"],
      reviewDurationMs: 1_500,
      reason: "人工逐帧确认摘要不准确",
      correctedResult: corrected,
      corrections: [
        {
          targetType: "annotation",
          targetId: "video",
          fieldPath: "video_summary",
          reasonCode: "SEMANTIC_ERROR",
          comment: "摘要用词修正",
        },
      ],
    });

    expect(result.run).toMatchObject({
      reviewStatus: "accepted_corrected",
      publicationStatus: "human_verified",
      reviewRevision: 1,
    });
    expect(await dataSource.getRepository(AnnotationReviewEntity).count()).toBe(1);
    expect(await dataSource.getRepository(AnnotationCorrectionEntity).findOneByOrFail({
      annotationRunId: "ANR-INITIAL",
    })).toMatchObject({
      fieldPath: "video_summary",
      previousValue: raw.video_summary,
      nextValue: corrected.video_summary,
    });
    expect(await dataSource.getRepository(VideoQualityResultEntity).count()).toBe(0);
    expect(await dataSource.getRepository(SubmissionEntity).findOneByOrFail({ id: "SUB-AN" })).toMatchObject({
      processingStatus: "completed",
      failureCode: null,
    });
    await expect(
      service.review(actor, "ANR-INITIAL", {
        expectedReviewRevision: 1,
        disposition: "accepted_unchanged",
        reviewedFields: ["video_summary"],
        reasonCodes: ["HUMAN_VERIFIED"],
        reviewDurationMs: 100,
        reason: "再次覆盖",
      }),
    ).rejects.toMatchObject({ code: "ANNOTATION_ALREADY_REVIEWED" });
  });

  it("distinguishes a new version run from same-run retry", async () => {
    const created = await service.createNewVersion(actor, "SUB-AN", "模型版本升级后重新生成");
    const runId = created.run.id;
    const repository = dataSource.getRepository(AnnotationRunEntity);
    const run = await repository.findOneByOrFail({ id: runId });
    run.executionStatus = "system_failed";
    run.promptVersion = "locked-prompt";
    run.promptContentSha256 = "b".repeat(64);
    run.systemPromptSnapshot = "locked system prompt";
    run.outputExampleSnapshot = { schema_version: "ego_video_annotation_v2" };
    run.model = "locked-model";
    run.attemptCount = 2;
    await repository.save(run);

    const retried = await service.retry(actor, runId, "网络恢复，重试同一配置");

    expect(retried.run).toMatchObject({
      id: runId,
      trigger: "manual",
      executionStatus: "queued",
      attemptCount: 2,
      promptVersion: "locked-prompt",
      model: "locked-model",
    });
    expect(await repository.countBy({ submissionId: "SUB-AN" })).toBe(2);
    expect(await dataSource.getRepository(JobOutboxEntity).findOneByOrFail({
      aggregateId: runId,
    })).toMatchObject({
      eventType: "ai.annotation.v1",
      status: "pending",
    });
  });
});
