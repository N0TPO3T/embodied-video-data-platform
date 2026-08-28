import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

import type { DataSource } from "typeorm";
import { vi } from "vitest";

import type { PublicUser } from "../src/auth/auth.types.js";
import { createDataSource } from "../src/database/data-source.js";
import { AnnotationReviewEntity } from "../src/database/entities/annotation-review.entity.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { JobOutboxEntity } from "../src/database/entities/job-outbox.entity.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TaskSegmentAssetEntity } from "../src/database/entities/task-segment-asset.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import type { ObjectStoragePort } from "../src/storage/object-storage.port.js";
import type { TaskSegmentMediaTool } from "../src/task-segment/task-segment-media.js";
import { TaskSegmentProcessor } from "../src/task-segment/task-segment.processor.js";
import { TaskSegmentService } from "../src/task-segment/task-segment.service.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

const admin: PublicUser = {
  id: "U-SEG-ADMIN",
  displayName: "片段管理员",
  username: "segment-admin",
  role: "admin",
  status: "active",
  updatedAt: 0,
};

class MemoryStorage implements ObjectStoragePort {
  readonly objects = new Map<string, Buffer>();

  async downloadObject(input: { objectKey: string; destinationPath: string }) {
    const value = this.objects.get(input.objectKey);
    if (!value) throw new Error(`object not found: ${input.objectKey}`);
    await writeFile(input.destinationPath, value);
  }

  async readObject(input: { objectKey: string }) {
    const value = this.objects.get(input.objectKey);
    if (!value) throw new Error(`object not found: ${input.objectKey}`);
    return Readable.from(value);
  }

  async uploadObject(input: { objectKey: string; sourcePath: string }) {
    this.objects.set(input.objectKey, await readFile(input.sourcePath));
  }

  async presignDownloadObject(input: { objectKey: string; expiresInSeconds: number }) {
    if (!this.objects.has(input.objectKey)) throw new Error("object not found");
    return {
      url: `https://storage.test/${input.objectKey}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000),
    };
  }

  async headObject(input: { objectKey: string }) {
    const value = this.objects.get(input.objectKey);
    if (!value) throw new Error(`object not found: ${input.objectKey}`);
    return { sizeBytes: String(value.length), contentType: "video/mp4" };
  }

  async deleteObject(input: { objectKey: string }) {
    this.objects.delete(input.objectKey);
  }

  async createMultipartUpload(): Promise<{ uploadId: string }> {
    throw new Error("not used");
  }

  async presignUploadPart(): Promise<never> {
    throw new Error("not used");
  }

  async completeMultipartUpload(): Promise<never> {
    throw new Error("not used");
  }

  async abortMultipartUpload(): Promise<void> {
    throw new Error("not used");
  }
}

class FakeSegmentMedia {
  failStartMs: number | null = 4_000;
  transcodeCalls = 0;

  async transcode(input: { outputPath: string; startMs: number; endMs: number }) {
    this.transcodeCalls += 1;
    if (input.startMs === this.failStartMs) throw new Error("intentional ffmpeg failure");
    await writeFile(input.outputPath, Buffer.from(String(input.endMs - input.startMs)));
  }

  async inspect(filePath: string) {
    const value = await readFile(filePath);
    const durationMs = Number(value.toString("utf8"));
    return {
      durationMs,
      sizeBytes: String(value.length),
      codec: "h264",
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: true,
      sha256: createHash("sha256").update(value).digest("hex"),
    };
  }
}

function normalizedResult(videoId: string, tasks: Array<Record<string, unknown>>) {
  return {
    status: "candidate",
    schemaVersion: "ego_video_annotation_v2",
    policyVersion: "ego_annotation_evidence_policy_v3",
    promptVersion: "ego_video_annotation_prompt_v2",
    promptContentSha256: "a".repeat(64),
    model: "qwen-demo",
    labelMappings: [],
    validation: { errors: [], warnings: [] },
    effective: {
      video_id: videoId,
      video_summary: "任务片段测试",
      scene: { coarse_label: "demo", fine_label: "demo", confidence: 1 },
      tasks,
      coverage_segments: tasks.map((task, taskIndex) => ({
        start_ms: task.start_ms,
        end_ms: task.end_ms,
        segment_type: "task",
        linked_task_index: taskIndex,
        visible_activity: task.task_label,
        evidence_timestamps_ms: [task.start_ms],
      })),
    },
  };
}

function task(input: {
  startMs: number;
  endMs: number;
  label: string;
  completion?: string;
  resultStatus?: string;
}) {
  return {
    start_ms: input.startMs,
    end_ms: input.endMs,
    task_label: input.label,
    task_verb: "pick_and_place",
    completion: input.completion ?? "complete",
    result_status: input.resultStatus ?? "success",
    effective_completion: input.completion ?? "complete",
    effective_result_status: input.resultStatus ?? "success",
    effective_failure_recovery: "none_observed",
    evidence_level: "direct_visual",
    evidence_timestamps_ms: [input.startMs],
    result_evidence_timestamps_ms: [input.endMs],
    failure_evidence_timestamps_ms: [],
    recovery_evidence_timestamps_ms: [],
    uncertainty_reasons: [],
    confidence: 0.9,
  };
}

describe("task segment demo", () => {
  let dataSource: DataSource;
  let storage: MemoryStorage;
  let media: FakeSegmentMedia;
  let service: TaskSegmentService;
  let processor: TaskSegmentProcessor;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    storage = new MemoryStorage();
    media = new FakeSegmentMedia();
    service = new TaskSegmentService(dataSource, storage);
    processor = new TaskSegmentProcessor(
      dataSource,
      storage,
      media as unknown as TaskSegmentMediaTool,
    );
    await dataSource.getRepository(TeamEntity).save({ id: "TEAM-SEG", name: "片段团队" });
    await dataSource.getRepository(UserEntity).save([
      {
        id: admin.id,
        displayName: admin.displayName,
        username: admin.username,
        usernameNormalized: admin.username,
        passwordHash: "unused",
        role: "admin",
        status: "active",
      },
      {
        id: "U-SEG-COLLECTOR",
        displayName: "片段采集员",
        username: "segment-collector",
        usernameNormalized: "segment-collector",
        passwordHash: "unused",
        role: "collector",
        teamId: "TEAM-SEG",
        status: "active",
      },
    ]);
    await seedSubmission("SUB-SEG", "uploads/task-segment-source.mp4", 10_000);
    storage.objects.set("uploads/task-segment-source.mp4", Buffer.from("source-video"));
    await seedRun("RUN-SEG", "SUB-SEG", [
      task({ startMs: 0, endMs: 2_000, label: "打开冰箱" }),
      task({ startMs: 1_800, endMs: 4_000, label: "取出饮料", completion: "incomplete", resultStatus: "partial" }),
      task({ startMs: 4_000, endMs: 6_000, label: "关闭冰箱", completion: "uncertain", resultStatus: "unknown" }),
    ]);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function seedSubmission(id: string, objectKey: string, durationMs: number) {
    await dataSource.getRepository(SubmissionEntity).save({
      id,
      ownerId: "U-SEG-COLLECTOR",
      teamId: "TEAM-SEG",
      originalFileName: `${id}.mp4`,
      contentType: "video/mp4",
      expectedSizeBytes: "12",
      checksumSha256: "b".repeat(64),
      objectKey,
      uploadStatus: "uploaded",
      processingStatus: "completed",
      storageStatus: "available",
      assetStatus: "active",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: id,
      durationSeconds: (durationMs / 1_000).toFixed(3),
      width: 1280,
      height: 720,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: "12",
      rawProbe: {},
    });
  }

  async function seedRun(
    id: string,
    submissionId: string,
    tasks: Array<Record<string, unknown>>,
    publicationStatus: "auto_accepted" | "candidate_only" = "auto_accepted",
  ) {
    await dataSource.getRepository(AnnotationRunEntity).save({
      id,
      submissionId,
      trigger: "manual",
      pipelineVersion: "ego_video_annotation_pipeline_v2",
      schemaVersion: "ego_video_annotation_v2",
      evidencePolicyVersion: "ego_annotation_evidence_policy_v3",
      promptVersion: "ego_video_annotation_prompt_v2",
      promptContentSha256: "a".repeat(64),
      systemPromptSnapshot: "demo system prompt",
      outputExampleSnapshot: { schema_version: "ego_video_annotation_v2" },
      model: "qwen-demo",
      executionStatus: "succeeded",
      reviewStatus: publicationStatus === "auto_accepted" ? "not_required" : "pending",
      publicationStatus,
      normalizedResult: normalizedResult(submissionId, tasks),
      autoEligibility: publicationStatus === "auto_accepted" ? "eligible" : "not_evaluated",
      autoGateVersion: publicationStatus === "auto_accepted" ? "annotation_auto_gate_v1" : null,
      autoGateIssues: [],
      wouldAutoAccept: publicationStatus === "auto_accepted",
      autoAcceptEnabledSnapshot: publicationStatus === "auto_accepted",
      autoGateEvaluatedAt: publicationStatus === "auto_accepted" ? new Date() : null,
      queuedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
    });
  }

  it("creates one internal asset per effective task and remains idempotent", async () => {
    await expect(service.generate(admin, "RUN-SEG")).resolves.toEqual({
      annotationRunId: "RUN-SEG",
      taskCount: 3,
      created: 3,
      existing: 0,
      skipped: 0,
    });
    await expect(service.generate(admin, "RUN-SEG")).resolves.toEqual({
      annotationRunId: "RUN-SEG",
      taskCount: 3,
      created: 0,
      existing: 3,
      skipped: 0,
    });
    const assets = await dataSource.getRepository(TaskSegmentAssetEntity).find({
      where: { annotationRunId: "RUN-SEG" },
      order: { taskIndex: "ASC" },
    });
    expect(assets).toHaveLength(3);
    expect(assets.map((asset) => [asset.taskIndex, asset.completion, asset.resultStatus])).toEqual([
      [0, "complete", "success"],
      [1, "incomplete", "partial"],
      [2, "uncertain", "unknown"],
    ]);
    expect(assets.every((asset) => asset.usageStatus === "internal_only")).toBe(true);
    expect(assets[1]).toMatchObject({ sourceStartMs: 1_800, sourceEndMs: 4_000 });
    expect(await dataSource.getRepository(JobOutboxEntity).countBy({
      eventType: "task.segment.generate.v1",
    })).toBe(3);
  });

  it("processes tasks independently, preserves source state, and retries one failure", async () => {
    const assets = await dataSource.getRepository(TaskSegmentAssetEntity).find({
      where: { annotationRunId: "RUN-SEG" },
      order: { taskIndex: "ASC" },
    });
    await expect(processor.process({ assetId: assets[0]!.id })).resolves.toBe("ready");
    await expect(processor.process({ assetId: assets[1]!.id })).resolves.toBe("ready");
    await expect(processor.process({ assetId: assets[2]!.id })).resolves.toBe("failed");
    expect(await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: assets[2]!.id })).toMatchObject({
      generationStatus: "failed",
      failureCode: "FFMPEG_FAILED",
    });
    expect(await dataSource.getRepository(SubmissionEntity).findOneByOrFail({ id: "SUB-SEG" })).toMatchObject({
      processingStatus: "completed",
      assetStatus: "active",
      storageStatus: "available",
      failureCode: null,
    });
    expect(await dataSource.getRepository(AnnotationRunEntity).findOneByOrFail({ id: "RUN-SEG" })).toMatchObject({
      executionStatus: "succeeded",
      publicationStatus: "auto_accepted",
    });

    media.failStartMs = null;
    await service.retry(admin, assets[2]!.id);
    await expect(processor.process({ assetId: assets[2]!.id })).resolves.toBe("ready");
    const retried = await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: assets[2]!.id });
    expect(retried).toMatchObject({
      generationStatus: "ready",
      attemptCount: 2,
      codec: "h264",
      width: 1280,
      height: 720,
      hasAudio: true,
    });
    expect(retried.clipSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(service.preview(admin, retried.id)).resolves.toMatchObject({
      assetId: retried.id,
      contentType: "video/mp4",
    });
    await expect(processor.process({ assetId: retried.id })).resolves.toBe("already_claimed");
  });

  it("marks an invalid task skipped and rejects non-published runs", async () => {
    await seedSubmission("SUB-SEG-INVALID", "uploads/invalid.mp4", 5_000);
    storage.objects.set("uploads/invalid.mp4", Buffer.from("invalid-source"));
    await seedRun("RUN-SEG-INVALID", "SUB-SEG-INVALID", [
      task({ startMs: 3_000, endMs: 2_000, label: "非法边界" }),
    ]);
    await expect(service.generate(admin, "RUN-SEG-INVALID")).resolves.toMatchObject({
      taskCount: 1,
      created: 1,
      skipped: 1,
    });
    expect(await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({
      annotationRunId: "RUN-SEG-INVALID",
    })).toMatchObject({
      generationStatus: "skipped",
      failureCode: "INVALID_TIME_RANGE",
    });

    await seedRun("RUN-SEG-CANDIDATE", "SUB-SEG-INVALID", [
      task({ startMs: 0, endMs: 1_000, label: "候选任务" }),
    ], "candidate_only");
    await expect(service.generate(admin, "RUN-SEG-CANDIDATE")).rejects.toMatchObject({
      code: "ANNOTATION_RUN_NOT_PUBLISHED",
      status: 409,
    });
    const candidate = await dataSource.getRepository(AnnotationRunEntity).findOneByOrFail({
      id: "RUN-SEG-CANDIDATE",
    });
    candidate.publicationStatus = "rejected";
    candidate.reviewStatus = "rejected";
    await dataSource.getRepository(AnnotationRunEntity).save(candidate);
    await expect(service.generate(admin, candidate.id)).rejects.toMatchObject({
      code: "ANNOTATION_RUN_NOT_PUBLISHED",
      status: 409,
    });
    candidate.publicationStatus = "superseded";
    candidate.reviewStatus = "not_required";
    await dataSource.getRepository(AnnotationRunEntity).save(candidate);
    await expect(service.generate(admin, candidate.id)).rejects.toMatchObject({
      code: "ANNOTATION_RUN_NOT_PUBLISHED",
      status: 409,
    });
    candidate.executionStatus = "system_failed";
    candidate.publicationStatus = "candidate_only";
    candidate.reviewStatus = "pending";
    await dataSource.getRepository(AnnotationRunEntity).save(candidate);
    await expect(service.generate(admin, candidate.id)).rejects.toMatchObject({
      code: "ANNOTATION_RUN_NOT_PUBLISHED",
      status: 409,
    });
    await expect(service.list({ ...admin, role: "collector" }, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("accepts a human-verified run with no tasks and returns an explicit empty result", async () => {
    await seedSubmission("SUB-SEG-HUMAN", "uploads/human.mp4", 5_000);
    storage.objects.set("uploads/human.mp4", Buffer.from("human-source"));
    await seedRun("RUN-SEG-HUMAN", "SUB-SEG-HUMAN", []);
    const run = await dataSource.getRepository(AnnotationRunEntity).findOneByOrFail({
      id: "RUN-SEG-HUMAN",
    });
    run.reviewStatus = "accepted_unchanged";
    run.publicationStatus = "human_verified";
    run.reviewRevision = 1;
    run.autoEligibility = "manual_required";
    run.autoGateVersion = null;
    run.wouldAutoAccept = false;
    run.autoAcceptEnabledSnapshot = false;
    run.autoGateEvaluatedAt = null;
    await dataSource.getRepository(AnnotationRunEntity).save(run);
    await dataSource.getRepository(AnnotationReviewEntity).save({
      id: "ANREV-SEG-HUMAN",
      annotationRunId: run.id,
      revision: 1,
      disposition: "accepted_unchanged",
      reviewKind: "blocking",
      reviewedFields: [],
      reasonCodes: [],
      reviewDurationMs: 1_000,
      reason: "人工确认",
      reviewerAccountId: admin.id,
      reviewerName: admin.displayName,
      correctedResult: null,
    });

    await expect(service.generate(admin, run.id)).resolves.toEqual({
      annotationRunId: run.id,
      taskCount: 0,
      created: 0,
      existing: 0,
      skipped: 0,
    });
  });

  it("records coverage warnings without blocking a technically valid task", async () => {
    await seedSubmission("SUB-SEG-WARNING", "uploads/warning.mp4", 5_000);
    storage.objects.set("uploads/warning.mp4", Buffer.from("warning-source"));
    await seedRun("RUN-SEG-WARNING", "SUB-SEG-WARNING", [
      task({ startMs: 500, endMs: 2_500, label: "warning 测试" }),
    ]);
    const run = await dataSource.getRepository(AnnotationRunEntity).findOneByOrFail({
      id: "RUN-SEG-WARNING",
    });
    const normalized = run.normalizedResult as {
      effective: { coverage_segments: Array<Record<string, unknown>> };
    };
    normalized.effective.coverage_segments[0] = {
      ...normalized.effective.coverage_segments[0],
      linked_task_index: 99,
      evidence_timestamps_ms: [6_000],
    };
    run.normalizedResult = normalized as never;
    await dataSource.getRepository(AnnotationRunEntity).save(run);

    await expect(service.generate(admin, run.id)).resolves.toMatchObject({
      created: 1,
      skipped: 0,
    });
    const asset = await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({
      annotationRunId: run.id,
    });
    expect(asset.generationStatus).toBe("queued");
    expect(asset.validationWarnings).toEqual(expect.arrayContaining([
      expect.stringContaining("out-of-range timestamp"),
      expect.stringContaining("linked_task_index is invalid"),
    ]));
  });

  it("recovers a claimed job and reuses an uploaded object after finalize failure", async () => {
    await seedSubmission("SUB-SEG-RECOVERY", "uploads/recovery.mp4", 5_000);
    storage.objects.set("uploads/recovery.mp4", Buffer.from("recovery-source"));
    await seedRun("RUN-SEG-RECOVERY", "SUB-SEG-RECOVERY", [
      task({ startMs: 500, endMs: 2_500, label: "恢复测试" }),
    ]);
    await service.generate(admin, "RUN-SEG-RECOVERY");
    const repository = dataSource.getRepository(TaskSegmentAssetEntity);
    const asset = await repository.findOneByOrFail({ annotationRunId: "RUN-SEG-RECOVERY" });
    const beforeTemp = new Set(
      (await readdir(tmpdir())).filter((name) => name.startsWith("evdp-task-segment-")),
    );
    const beforeTranscodes = media.transcodeCalls;
    const finalize = vi
      .spyOn(processor as unknown as { finalize: () => Promise<void> }, "finalize")
      .mockRejectedValueOnce(new Error("simulated finalize failure"));

    await expect(processor.process({ assetId: asset.id })).rejects.toThrow(
      /DATABASE_FINALIZE_FAILED/u,
    );
    finalize.mockRestore();
    const failed = await repository.findOneByOrFail({ id: asset.id });
    expect(failed).toMatchObject({
      generationStatus: "failed",
      failureCode: "DATABASE_FINALIZE_FAILED",
      attemptCount: 1,
    });
    expect(storage.objects.has(asset.clipObjectKey!)).toBe(true);
    expect(media.transcodeCalls).toBe(beforeTranscodes + 1);

    await expect(processor.process({ assetId: asset.id })).resolves.toBe("ready");
    expect(media.transcodeCalls).toBe(beforeTranscodes + 1);
    expect(await repository.findOneByOrFail({ id: asset.id })).toMatchObject({
      generationStatus: "ready",
      attemptCount: 2,
    });
    const afterTemp = new Set(
      (await readdir(tmpdir())).filter((name) => name.startsWith("evdp-task-segment-")),
    );
    expect(afterTemp).toEqual(beforeTemp);

    const recovered = await repository.findOneByOrFail({ id: asset.id });
    recovered.generationStatus = "processing";
    await repository.save(recovered);
    await expect(processor.process({ assetId: asset.id })).resolves.toBe("already_claimed");
    await expect(processor.process({
      assetId: asset.id,
      recoverProcessing: true,
    })).resolves.toBe("ready");
  });
});
