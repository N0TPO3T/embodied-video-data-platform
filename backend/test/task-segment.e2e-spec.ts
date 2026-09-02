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
import { TaskBoundaryRefinementEntity } from "../src/database/entities/task-boundary-refinement.entity.js";
import { TaskSegmentAssetEntity } from "../src/database/entities/task-segment-asset.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import type { ObjectStoragePort } from "../src/storage/object-storage.port.js";
import {
  taskBoundarySamplePlan,
  type TaskBoundaryFrameSampler,
} from "../src/task-segment/task-boundary-frame-sampler.js";
import type {
  TaskBoundaryRefinementProvider,
  TaskBoundaryRefinementRequest,
} from "../src/task-segment/task-boundary-refinement.provider.js";
import { TaskBoundaryRefinementProcessor } from "../src/task-segment/task-boundary-refinement.processor.js";
import type { TaskSegmentMediaTool } from "../src/task-segment/task-segment-media.js";
import {
  RetryableTaskSegmentError,
  TaskSegmentProcessor,
} from "../src/task-segment/task-segment.processor.js";
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
  failStreamCopyStartMs: number | null = 4_000;
  failExactStartMs: number | null = 4_000;
  streamCopyStartDriftMs = 0;
  keyframes: number[] | null = Array.from(
    { length: 41 },
    (_, index) => index * 500,
  );
  transcodeCalls = 0;

  async inspectSource() {
    return {
      codec: "h264",
      container: "mov",
      nominalFps: 30,
      hasAudio: true,
      startMs: 0,
      durationMs: 20_000,
      timestampRisk: false,
    };
  }

  async keyframeIndex() {
    return this.keyframes;
  }

  async materializeByStreamCopy(input: {
    outputPath: string;
    requestedStartMs: number;
    requestedEndMs: number;
  }) {
    this.transcodeCalls += 1;
    if (input.requestedStartMs === this.failStreamCopyStartMs) {
      throw new Error("intentional stream-copy failure");
    }
    await writeFile(input.outputPath, Buffer.from(JSON.stringify({
      startMs: input.requestedStartMs + this.streamCopyStartDriftMs,
      durationMs:
        input.requestedEndMs -
        input.requestedStartMs -
        this.streamCopyStartDriftMs,
    })));
  }

  async materializeByExactTranscode(input: {
    outputPath: string;
    requestedStartMs: number;
    requestedEndMs: number;
  }) {
    this.transcodeCalls += 1;
    if (input.requestedStartMs === this.failExactStartMs) {
      throw new Error("intentional exact-transcode failure");
    }
    await writeFile(input.outputPath, Buffer.from(JSON.stringify({
      startMs: 0,
      durationMs: input.requestedEndMs - input.requestedStartMs,
    })));
  }

  async inspect(filePath: string) {
    const value = await readFile(filePath);
    const parsed = JSON.parse(value.toString("utf8")) as {
      startMs: number;
      durationMs: number;
    };
    return {
      startMs: parsed.startMs,
      durationMs: parsed.durationMs,
      videoDurationMs: parsed.durationMs,
      audioDurationMs: parsed.durationMs,
      sizeBytes: String(value.length),
      codec: "h264",
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: true,
      sha256: createHash("sha256").update(value).digest("hex"),
    };
  }

  async assertFullyDecodable() {}
}

class FakeBoundarySampler implements TaskBoundaryFrameSampler {
  readonly calls: Array<{ coarseStartMs: number; coarseEndMs: number }> = [];

  async extract(input: {
    coarseStartMs: number;
    coarseEndMs: number;
    videoDurationMs: number;
  }) {
    this.calls.push({
      coarseStartMs: input.coarseStartMs,
      coarseEndMs: input.coarseEndMs,
    });
    const plan = taskBoundarySamplePlan(input);
    const frames = plan.requests.map((request) => ({
      requestedTimestampsMs: [request.timestampMs],
      timestampMs: request.timestampMs,
      windows: request.windows,
      dataUrl: "data:image/jpeg;base64,AA==",
    }));
    return {
      frames,
      manifest: {
        requestedStartTimestampsMs: plan.requestedStartTimestampsMs,
        requestedEndTimestampsMs: plan.requestedEndTimestampsMs,
        frames: frames.map(({ dataUrl: _dataUrl, ...frame }) => frame),
      },
    };
  }
}

class FakeBoundaryProvider implements TaskBoundaryRefinementProvider {
  readonly calls: TaskBoundaryRefinementRequest[] = [];
  mode: "success" | "throw" | "invalid" = "success";

  async refine(request: TaskBoundaryRefinementRequest) {
    this.calls.push(request);
    if (this.mode === "throw") throw new Error("intentional provider failure");
    const startTimestamp = this.mode === "invalid"
      ? request.coarseStartMs + 123
      : Math.max(0, request.coarseStartMs - 1_000);
    const endTimestamp = Math.min(
      request.videoDurationMs,
      request.coarseEndMs + 1_000,
    );
    const output = {
      task_index: request.taskIndex,
      start: {
        coarse_timestamp_ms: request.coarseStartMs,
        refined_timestamp_ms: startTimestamp,
        status: "refined" as const,
        evidence_timestamps_ms: [startTimestamp],
        reason_code: "CLEAR_TRANSITION" as const,
      },
      end: {
        coarse_timestamp_ms: request.coarseEndMs,
        refined_timestamp_ms: endTimestamp,
        status: "refined" as const,
        evidence_timestamps_ms: [endTimestamp],
        reason_code: "CLEAR_TRANSITION" as const,
      },
    };
    return {
      output,
      rawModelOutput: output,
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 30,
      responseModel: request.modelVersion,
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
  const originalRefinementFlag = process.env.TASK_BOUNDARY_REFINEMENT_ENABLED;
  let dataSource: DataSource;
  let storage: MemoryStorage;
  let media: FakeSegmentMedia;
  let service: TaskSegmentService;
  let processor: TaskSegmentProcessor;

  beforeAll(async () => {
    process.env.TASK_BOUNDARY_REFINEMENT_ENABLED = "false";
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
      task({ startMs: 0, endMs: 4_000, label: "打开冰箱" }),
      task({ startMs: 4_500, endMs: 8_000, label: "取出饮料", completion: "incomplete", resultStatus: "partial" }),
      task({ startMs: 8_000, endMs: 9_500, label: "关闭冰箱", completion: "uncertain", resultStatus: "unknown" }),
      task({ startMs: 9_700, endMs: 9_900, label: "短任务", completion: "complete", resultStatus: "success" }),
    ]);
  });

  afterAll(async () => {
    if (originalRefinementFlag === undefined) {
      delete process.env.TASK_BOUNDARY_REFINEMENT_ENABLED;
    } else {
      process.env.TASK_BOUNDARY_REFINEMENT_ENABLED = originalRefinementFlag;
    }
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  afterEach(() => {
    process.env.TASK_BOUNDARY_REFINEMENT_ENABLED = "false";
    media.failStreamCopyStartMs = null;
    media.failExactStartMs = null;
    media.streamCopyStartDriftMs = 0;
    media.keyframes = Array.from({ length: 41 }, (_, index) => index * 500);
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
    // 正式 V1 规则：task1 正常入库；task2 uncertain 不入库（TASK_STATUS_UNCERTAIN）；
    // task3 padding 后 9200→10000ms 不足最短 3s（TASK_TOO_SHORT）；task0/1 带 padding 入库。
    await expect(service.generate(admin, "RUN-SEG")).resolves.toEqual({
      annotationRunId: "RUN-SEG",
      taskCount: 4,
      created: 4,
      existing: 0,
      skipped: 2,
    });
    await expect(service.generate(admin, "RUN-SEG")).resolves.toEqual({
      annotationRunId: "RUN-SEG",
      taskCount: 4,
      created: 0,
      existing: 4,
      skipped: 0,
    });
    const assets = await dataSource.getRepository(TaskSegmentAssetEntity).find({
      where: { annotationRunId: "RUN-SEG" },
      order: { taskIndex: "ASC" },
    });
    expect(assets).toHaveLength(4);
    expect(assets.map((asset) => [asset.taskIndex, asset.completion, asset.resultStatus])).toEqual([
      [0, "complete", "success"],
      [1, "incomplete", "partial"],
      [2, "uncertain", "unknown"],
      [3, "complete", "success"],
    ]);
    expect(assets.every((asset) => asset.usageStatus === "internal_only")).toBe(true);
    // SEG-DEC-002：±0.5s padding（clamp 到视频范围）；source 区间保留任务原始边界
    expect(assets[0]).toMatchObject({ sourceStartMs: 0, sourceEndMs: 4_000, clipStartMs: 0, clipEndMs: 4_500 });
    expect(assets[1]).toMatchObject({ sourceStartMs: 4_500, sourceEndMs: 8_000, clipStartMs: 4_000, clipEndMs: 8_500 });
    expect(assets[2]).toMatchObject({
      generationStatus: "skipped",
      failureCode: "TASK_STATUS_UNCERTAIN",
    });
    expect(assets[3]).toMatchObject({
      generationStatus: "skipped",
      failureCode: "TASK_TOO_SHORT",
    });
    expect(await dataSource.getRepository(JobOutboxEntity).countBy({
      eventType: "task.segment.generate.v1",
    })).toBe(2);
    expect(await dataSource.getRepository(TaskBoundaryRefinementEntity).countBy({
      annotationRunId: "RUN-SEG",
    })).toBe(0);
  });

  it("processes tasks independently, preserves source state, and retries one failure", async () => {
    media.failStreamCopyStartMs = 4_000;
    media.failExactStartMs = 4_000;
    const assets = await dataSource.getRepository(TaskSegmentAssetEntity).find({
      where: { annotationRunId: "RUN-SEG" },
      order: { taskIndex: "ASC" },
    });
    // assets[1] 的 requestedStartMs=4000：copy 与 exact 都被故障注入阻断。
    await expect(processor.process({ assetId: assets[0]!.id })).resolves.toBe("ready");
    await expect(
      processor.process({ assetId: assets[1]!.id }),
    ).rejects.toBeInstanceOf(RetryableTaskSegmentError);
    expect(await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: assets[1]!.id })).toMatchObject({
      generationStatus: "failed",
      failureCode: "EXACT_TRANSCODE_FAILED",
      validationStatus: "failed",
    });
    expect(storage.objects.has(assets[1]!.clipObjectKey!)).toBe(false);
    // skipped 资产不可处理（claim 返回 null）
    await expect(processor.process({ assetId: assets[2]!.id })).resolves.toBe("already_claimed");
    await expect(processor.process({ assetId: assets[3]!.id })).resolves.toBe("already_claimed");
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

    media.failStreamCopyStartMs = null;
    media.failExactStartMs = null;
    await service.retry(admin, assets[1]!.id);
    await expect(processor.process({ assetId: assets[1]!.id })).resolves.toBe("ready");
    const retried = await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: assets[1]!.id });
    expect(retried).toMatchObject({
      generationStatus: "ready",
      attemptCount: 2,
      codec: "h264",
      width: 1280,
      height: 720,
      hasAudio: true,
    });
    // SEG-DEC-009 决策 a：实际边界（关键帧对齐后）写回 clipStartMs/clipEndMs
    expect(retried.clipStartMs).toBe(4_000);
    expect(retried.clipEndMs).toBe(8_500);
    expect(retried.clipDurationMs).toBe(4_500);
    expect(retried.clipSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(service.preview(admin, retried.id)).resolves.toMatchObject({
      assetId: retried.id,
      contentType: "video/mp4",
    });
    await expect(processor.process({ assetId: retried.id })).resolves.toBe("already_claimed");
  });

  it("rejects a drifting copy candidate and uploads only the exact transcode", async () => {
    await seedSubmission("SUB-SEG-ADAPTIVE", "uploads/adaptive.mp4", 12_000);
    storage.objects.set("uploads/adaptive.mp4", Buffer.from("adaptive-source"));
    await seedRun("RUN-SEG-ADAPTIVE", "SUB-SEG-ADAPTIVE", [
      task({ startMs: 4_500, endMs: 7_500, label: "精确放置" }),
    ]);
    await service.generate(admin, "RUN-SEG-ADAPTIVE");
    const asset = await dataSource.getRepository(TaskSegmentAssetEntity)
      .findOneByOrFail({ annotationRunId: "RUN-SEG-ADAPTIVE" });
    expect(asset).toMatchObject({
      requestedStartMs: 4_000,
      requestedEndMs: 8_000,
      validationStatus: "pending",
    });
    const callsBefore = media.transcodeCalls;
    media.streamCopyStartDriftMs = -2_000;

    await expect(processor.process({ assetId: asset.id })).resolves.toBe("ready");
    const completed = await dataSource.getRepository(TaskSegmentAssetEntity)
      .findOneByOrFail({ id: asset.id });
    expect(completed).toMatchObject({
      generationStatus: "ready",
      validationStatus: "passed",
      materializationPolicyVersion: "task_segment_adaptive_cut_policy_v1",
      materializationMode: "exact_clip_transcode",
      streamCopyAttempted: true,
      copyRejectedReason: "STREAM_COPY_DRIFT_EXCEEDED",
      predictedCopyStartMs: 4_000,
      keyframeDistanceStartMs: 0,
      requestedStartMs: 4_000,
      requestedEndMs: 8_000,
      actualStartMs: 4_000,
      actualEndMs: 8_000,
      startDriftMs: 0,
      endDriftMs: 0,
      transcodedInputDurationMs: 4_000,
    });
    expect(completed.boundaryToleranceMs).toBeCloseTo(66.667, 2);
    expect(media.transcodeCalls).toBe(callsBefore + 2);
    expect(storage.objects.has(completed.clipObjectKey!)).toBe(true);
    expect(await processor.process({ assetId: completed.id })).toBe(
      "already_claimed",
    );
  });

  it("acks ready assets after source deletion and terminally fails unfinished assets", async () => {
    await seedSubmission("SUB-SEG-DELETED", "uploads/deleted-source.mp4", 8_000);
    storage.objects.set("uploads/deleted-source.mp4", Buffer.from("deleted-source"));
    await seedRun("RUN-SEG-DELETED", "SUB-SEG-DELETED", [
      task({ startMs: 1_000, endMs: 5_000, label: "删除后幂等" }),
    ]);
    await service.generate(admin, "RUN-SEG-DELETED");
    const repository = dataSource.getRepository(TaskSegmentAssetEntity);
    const asset = await repository.findOneByOrFail({
      annotationRunId: "RUN-SEG-DELETED",
    });

    const submissionRepository = dataSource.getRepository(SubmissionEntity);
    const submission = await submissionRepository.findOneByOrFail({
      id: "SUB-SEG-DELETED",
    });
    submission.storageStatus = "deleted";
    submission.storageDeletedAt = new Date();
    await submissionRepository.save(submission);
    storage.objects.delete(submission.objectKey);

    await expect(processor.process({ assetId: asset.id })).resolves.toBe("failed");
    expect(await repository.findOneByOrFail({ id: asset.id })).toMatchObject({
      generationStatus: "failed",
      validationStatus: "failed",
      failureCode: "SOURCE_MEDIA_UNAVAILABLE",
    });

    const completed = await repository.findOneByOrFail({ id: asset.id });
    completed.generationStatus = "ready";
    completed.validationStatus = "passed";
    completed.clipSha256 = "d".repeat(64);
    completed.clipSizeBytes = "10";
    completed.clipDurationMs = 5_000;
    completed.codec = "h264";
    completed.width = 1280;
    completed.height = 720;
    completed.frameRate = 30;
    completed.hasAudio = true;
    completed.completedAt = new Date();
    await repository.save(completed);
    await expect(processor.process({ assetId: asset.id })).resolves.toBe(
      "already_claimed",
    );
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

  it("enqueueForPublishedRun runs inside the publisher transaction and is idempotent", async () => {
    // 非正式 Run 在发布事务内拒绝
    await expect(
      dataSource.transaction(async (manager) => {
        const run = await manager.getRepository(AnnotationRunEntity).findOneByOrFail({
          id: "RUN-SEG-CANDIDATE",
        });
        return service.enqueueForPublishedRun(manager, run);
      }),
    ).rejects.toMatchObject({
      code: "ANNOTATION_RUN_NOT_PUBLISHED",
      status: 409,
    });

    const outboxBefore = await dataSource.getRepository(JobOutboxEntity).countBy({
      eventType: "task.segment.generate.v1",
    });
    // 正式 Run：发布事务内调用创建资产；重复发布不重复创建
    const result = await dataSource.transaction(async (manager) => {
      const run = await manager.getRepository(AnnotationRunEntity).findOneByOrFail({
        id: "RUN-SEG",
      });
      return service.enqueueForPublishedRun(manager, run);
    });
    expect(result).toMatchObject({
      annotationRunId: "RUN-SEG",
      taskCount: 4,
      created: 0,
      existing: 4,
      skipped: 0,
    });
    // 幂等：未新增 outbox 消息（enqueueAsset 为 upsert）。
    expect(await dataSource.getRepository(JobOutboxEntity).countBy({
      eventType: "task.segment.generate.v1",
    })).toBe(outboxBefore);
  });

  it("refines one formal task once, preserves coarse boundaries, then applies existing padding", async () => {
    process.env.TASK_BOUNDARY_REFINEMENT_ENABLED = "true";
    await seedSubmission("SUB-BOUNDARY-OK", "uploads/boundary-ok.mp4", 15_000);
    storage.objects.set("uploads/boundary-ok.mp4", Buffer.from("boundary-source"));
    await seedRun("RUN-BOUNDARY-OK", "SUB-BOUNDARY-OK", [
      task({ startMs: 5_000, endMs: 10_000, label: "放置杯子" }),
    ]);
    const sampler = new FakeBoundarySampler();
    const provider = new FakeBoundaryProvider();
    const refinementProcessor = new TaskBoundaryRefinementProcessor(
      dataSource,
      storage,
      sampler,
      provider,
    );

    await expect(service.generate(admin, "RUN-BOUNDARY-OK")).resolves.toMatchObject({
      created: 1,
      skipped: 0,
    });
    const refinementRepository = dataSource.getRepository(TaskBoundaryRefinementEntity);
    const refinement = await refinementRepository.findOneByOrFail({
      annotationRunId: "RUN-BOUNDARY-OK",
    });
    const initialAsset = await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({
      annotationRunId: "RUN-BOUNDARY-OK",
    });
    expect(refinement).toMatchObject({
      executionStatus: "queued",
      coarseStartMs: 5_000,
      coarseEndMs: 10_000,
    });
    expect(initialAsset).toMatchObject({
      sourceStartMs: 5_000,
      sourceEndMs: 10_000,
      boundarySource: "coarse",
      generationStatus: "queued",
    });
    expect(await dataSource.getRepository(JobOutboxEntity).countBy({
      aggregateId: refinement.id,
      eventType: "task.boundary.refine.v1",
    })).toBe(1);
    expect(await dataSource.getRepository(JobOutboxEntity).countBy({
      aggregateId: initialAsset.id,
      eventType: "task.segment.generate.v1",
    })).toBe(0);
    const isolatedBefore = await Promise.all([
      dataSource.query(
        'SELECT processing_status, asset_status, storage_status FROM submissions WHERE id = $1',
        ["SUB-BOUNDARY-OK"],
      ),
      dataSource.query(
        'SELECT execution_status, publication_status FROM annotation_runs WHERE id = $1',
        ["RUN-BOUNDARY-OK"],
      ),
      dataSource.query(
        'SELECT count(*)::int AS count FROM video_quality_results WHERE submission_id = $1',
        ["SUB-BOUNDARY-OK"],
      ),
      dataSource.query(
        'SELECT count(*)::int AS count FROM point_cycle_items WHERE submission_id = $1',
        ["SUB-BOUNDARY-OK"],
      ),
    ]);

    await expect(refinementProcessor.process({ refinementId: refinement.id })).resolves.toBe(
      "succeeded",
    );
    await expect(refinementProcessor.process({ refinementId: refinement.id })).resolves.toBe(
      "already_claimed",
    );
    expect(provider.calls).toHaveLength(1);
    expect(sampler.calls).toHaveLength(1);
    const completed = await refinementRepository.findOneByOrFail({ id: refinement.id });
    const asset = await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({
      id: initialAsset.id,
    });
    expect(completed).toMatchObject({
      executionStatus: "succeeded",
      refinedStartMs: 4_000,
      refinedEndMs: 11_000,
      inputTokens: 10,
      outputTokens: 20,
    });
    expect(asset).toMatchObject({
      sourceStartMs: 5_000,
      sourceEndMs: 10_000,
      refinedStartMs: 4_000,
      refinedEndMs: 11_000,
      clipStartMs: 3_500,
      clipEndMs: 11_500,
      boundarySource: "refined",
      generationStatus: "queued",
    });
    expect(await dataSource.getRepository(JobOutboxEntity).countBy({
      aggregateId: asset.id,
      eventType: "task.segment.generate.v1",
    })).toBe(1);

    await expect(service.generate(admin, "RUN-BOUNDARY-OK")).resolves.toMatchObject({
      created: 0,
      existing: 1,
    });
    expect(await refinementRepository.countBy({ annotationRunId: "RUN-BOUNDARY-OK" })).toBe(1);
    expect(provider.calls).toHaveLength(1);

    const technical = await service.get(admin, asset.id);
    expect(technical.asset).toMatchObject({
      coarseStartMs: 5_000,
      coarseEndMs: 10_000,
      refinedStartMs: 4_000,
      refinedEndMs: 11_000,
      actualClipStartMs: null,
      actualClipEndMs: null,
      boundaryRefinementStatus: "succeeded",
    });
    media.failStreamCopyStartMs = null;
    media.failExactStartMs = null;
    await expect(processor.process({ assetId: asset.id })).resolves.toBe("ready");
    await expect(service.get(admin, asset.id)).resolves.toMatchObject({
      asset: {
        coarseStartMs: 5_000,
        coarseEndMs: 10_000,
        refinedStartMs: 4_000,
        refinedEndMs: 11_000,
        actualClipStartMs: 3_500,
        actualClipEndMs: 11_500,
        boundarySource: "refined",
      },
    });
    expect(await dataSource.getRepository(SubmissionEntity).findOneByOrFail({
      id: "SUB-BOUNDARY-OK",
    })).toMatchObject({
      processingStatus: "completed",
      storageStatus: "available",
      assetStatus: "active",
    });
    expect(await dataSource.getRepository(AnnotationRunEntity).findOneByOrFail({
      id: "RUN-BOUNDARY-OK",
    })).toMatchObject({
      executionStatus: "succeeded",
      publicationStatus: "auto_accepted",
    });
    expect(await Promise.all([
      dataSource.query(
        'SELECT processing_status, asset_status, storage_status FROM submissions WHERE id = $1',
        ["SUB-BOUNDARY-OK"],
      ),
      dataSource.query(
        'SELECT execution_status, publication_status FROM annotation_runs WHERE id = $1',
        ["RUN-BOUNDARY-OK"],
      ),
      dataSource.query(
        'SELECT count(*)::int AS count FROM video_quality_results WHERE submission_id = $1',
        ["SUB-BOUNDARY-OK"],
      ),
      dataSource.query(
        'SELECT count(*)::int AS count FROM point_cycle_items WHERE submission_id = $1',
        ["SUB-BOUNDARY-OK"],
      ),
    ])).toEqual(isolatedBefore);
  });

  it("falls back the whole task to coarse boundaries on provider or schema failure", async () => {
    process.env.TASK_BOUNDARY_REFINEMENT_ENABLED = "true";
    for (const [suffix, mode] of [
      ["PROVIDER", "throw"],
      ["INVALID", "invalid"],
    ] as const) {
      const submissionId = `SUB-BOUNDARY-${suffix}`;
      const runId = `RUN-BOUNDARY-${suffix}`;
      await seedSubmission(submissionId, `uploads/boundary-${suffix.toLowerCase()}.mp4`, 15_000);
      storage.objects.set(`uploads/boundary-${suffix.toLowerCase()}.mp4`, Buffer.from("source"));
      await seedRun(runId, submissionId, [
        task({ startMs: 5_000, endMs: 10_000, label: `fallback-${suffix}` }),
      ]);
      const provider = new FakeBoundaryProvider();
      provider.mode = mode;
      const refinementProcessor = new TaskBoundaryRefinementProcessor(
        dataSource,
        storage,
        new FakeBoundarySampler(),
        provider,
      );
      await service.generate(admin, runId);
      const refinement = await dataSource.getRepository(TaskBoundaryRefinementEntity).findOneByOrFail({
        annotationRunId: runId,
      });

      await expect(refinementProcessor.process({ refinementId: refinement.id })).resolves.toBe(
        "fallback",
      );
      expect(provider.calls).toHaveLength(1);
      const fallback = await dataSource.getRepository(TaskBoundaryRefinementEntity).findOneByOrFail({
        id: refinement.id,
      });
      const asset = await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({
        annotationRunId: runId,
      });
      expect(fallback).toMatchObject({
        executionStatus: "fallback",
        startStatus: "failed",
        endStatus: "failed",
        refinedStartMs: null,
        refinedEndMs: null,
      });
      expect(asset).toMatchObject({
        generationStatus: "queued",
        boundarySource: "coarse_fallback",
        sourceStartMs: 5_000,
        sourceEndMs: 10_000,
        refinedStartMs: null,
        refinedEndMs: null,
        clipStartMs: 4_500,
        clipEndMs: 10_500,
        failureCode: null,
      });
      expect(await dataSource.getRepository(JobOutboxEntity).countBy({
        aggregateId: asset.id,
        eventType: "task.segment.generate.v1",
      })).toBe(1);
    }
  });

  it("does not issue a second model call when recovering a running refinement", async () => {
    process.env.TASK_BOUNDARY_REFINEMENT_ENABLED = "true";
    await seedSubmission("SUB-BOUNDARY-RECOVER", "uploads/boundary-recover.mp4", 12_000);
    storage.objects.set("uploads/boundary-recover.mp4", Buffer.from("source"));
    await seedRun("RUN-BOUNDARY-RECOVER", "SUB-BOUNDARY-RECOVER", [
      task({ startMs: 3_000, endMs: 8_000, label: "恢复中的任务" }),
    ]);
    await service.generate(admin, "RUN-BOUNDARY-RECOVER");
    const repository = dataSource.getRepository(TaskBoundaryRefinementEntity);
    const refinement = await repository.findOneByOrFail({
      annotationRunId: "RUN-BOUNDARY-RECOVER",
    });
    refinement.executionStatus = "running";
    await repository.save(refinement);
    const provider = new FakeBoundaryProvider();
    const refinementProcessor = new TaskBoundaryRefinementProcessor(
      dataSource,
      storage,
      new FakeBoundarySampler(),
      provider,
    );

    await expect(refinementProcessor.process({
      refinementId: refinement.id,
      recoverRunning: true,
    })).resolves.toBe("system_failed");
    expect(provider.calls).toHaveLength(0);
    expect(await repository.findOneByOrFail({ id: refinement.id })).toMatchObject({
      executionStatus: "system_failed",
      failureCode: "REFINEMENT_INTERRUPTED",
    });
    expect(await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({
      annotationRunId: "RUN-BOUNDARY-RECOVER",
    })).toMatchObject({
      boundarySource: "coarse_fallback",
      generationStatus: "queued",
    });
  });

  it("keeps overlap and task-status inventory rules after refinement", async () => {
    process.env.TASK_BOUNDARY_REFINEMENT_ENABLED = "true";
    await seedSubmission("SUB-BOUNDARY-RULES", "uploads/boundary-rules.mp4", 20_000);
    storage.objects.set("uploads/boundary-rules.mp4", Buffer.from("source"));
    await seedRun("RUN-BOUNDARY-RULES", "SUB-BOUNDARY-RULES", [
      task({ startMs: 2_000, endMs: 8_000, label: "failed task", completion: "failed", resultStatus: "failed" }),
      task({ startMs: 6_000, endMs: 12_000, label: "incomplete task", completion: "incomplete", resultStatus: "partial" }),
      task({ startMs: 13_000, endMs: 17_000, label: "uncertain task", completion: "uncertain", resultStatus: "unknown" }),
    ]);
    const provider = new FakeBoundaryProvider();
    const refinementProcessor = new TaskBoundaryRefinementProcessor(
      dataSource,
      storage,
      new FakeBoundarySampler(),
      provider,
    );
    await service.generate(admin, "RUN-BOUNDARY-RULES");
    const refinements = await dataSource.getRepository(TaskBoundaryRefinementEntity).find({
      where: { annotationRunId: "RUN-BOUNDARY-RULES" },
      order: { taskIndex: "ASC" },
    });
    expect(refinements).toHaveLength(3);
    expect(refinements[2]).toMatchObject({
      executionStatus: "fallback",
      failureCode: "TASK_STATUS_UNCERTAIN",
    });
    await refinementProcessor.process({ refinementId: refinements[0]!.id });
    await refinementProcessor.process({ refinementId: refinements[1]!.id });
    expect(provider.calls).toHaveLength(2);
    const assets = await dataSource.getRepository(TaskSegmentAssetEntity).find({
      where: { annotationRunId: "RUN-BOUNDARY-RULES" },
      order: { taskIndex: "ASC" },
    });
    expect(assets[0]).toMatchObject({ generationStatus: "queued", completion: "failed" });
    expect(assets[1]).toMatchObject({ generationStatus: "queued", completion: "incomplete" });
    expect(assets[2]).toMatchObject({
      generationStatus: "skipped",
      failureCode: "TASK_STATUS_UNCERTAIN",
    });
    expect(assets[0]!.clipEndMs).toBeGreaterThan(assets[1]!.clipStartMs);
  });

  it("creates a refinement for a human-verified run and none for non-formal runs", async () => {
    process.env.TASK_BOUNDARY_REFINEMENT_ENABLED = "true";
    await seedSubmission("SUB-BOUNDARY-HUMAN", "uploads/boundary-human.mp4", 10_000);
    storage.objects.set("uploads/boundary-human.mp4", Buffer.from("source"));
    await seedRun("RUN-BOUNDARY-HUMAN", "SUB-BOUNDARY-HUMAN", [
      task({ startMs: 1_000, endMs: 5_000, label: "人工正式任务" }),
    ]);
    const human = await dataSource.getRepository(AnnotationRunEntity).findOneByOrFail({
      id: "RUN-BOUNDARY-HUMAN",
    });
    human.reviewStatus = "accepted_unchanged";
    human.publicationStatus = "human_verified";
    human.reviewRevision = 1;
    human.autoEligibility = "manual_required";
    human.autoGateVersion = null;
    human.wouldAutoAccept = false;
    human.autoAcceptEnabledSnapshot = false;
    human.autoGateEvaluatedAt = null;
    await dataSource.getRepository(AnnotationRunEntity).save(human);
    await dataSource.getRepository(AnnotationReviewEntity).save({
      id: "ANREV-BOUNDARY-HUMAN",
      annotationRunId: human.id,
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
    await service.generate(admin, human.id);
    expect(await dataSource.getRepository(TaskBoundaryRefinementEntity).countBy({
      annotationRunId: human.id,
    })).toBe(1);

    human.publicationStatus = "superseded";
    await dataSource.getRepository(AnnotationRunEntity).save(human);
    await seedRun("RUN-BOUNDARY-NEW", "SUB-BOUNDARY-HUMAN", [
      task({ startMs: 2_000, endMs: 6_000, label: "新正式任务" }),
    ]);
    await service.generate(admin, "RUN-BOUNDARY-NEW");
    expect(await dataSource.getRepository(TaskBoundaryRefinementEntity).countBy({
      annotationRunId: "RUN-BOUNDARY-NEW",
    })).toBe(1);
    expect(await dataSource.getRepository(TaskBoundaryRefinementEntity).countBy({
      annotationRunId: human.id,
    })).toBe(1);

    await seedRun("RUN-BOUNDARY-CANDIDATE", "SUB-BOUNDARY-HUMAN", [
      task({ startMs: 5_000, endMs: 8_000, label: "候选任务" }),
    ], "candidate_only");
    await expect(service.generate(admin, "RUN-BOUNDARY-CANDIDATE")).rejects.toMatchObject({
      code: "ANNOTATION_RUN_NOT_PUBLISHED",
    });
    expect(await dataSource.getRepository(TaskBoundaryRefinementEntity).countBy({
      annotationRunId: "RUN-BOUNDARY-CANDIDATE",
    })).toBe(0);
  });
});
