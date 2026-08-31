import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import { AuditService } from "../src/audit/audit.service.js";
import { createDataSource } from "../src/database/data-source.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TaskSegmentAssetEntity } from "../src/database/entities/task-segment-asset.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import type { ObjectStoragePort } from "../src/storage/object-storage.port.js";
import {
  RetryableSourceRetentionError,
  SourceRetentionProcessor,
} from "../src/task-segment/source-retention.processor.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

class RetentionStorage implements ObjectStoragePort {
  readonly objects = new Map<string, Buffer>();
  deletedKeys: string[] = [];

  async downloadObject(input: { objectKey: string; destinationPath: string }) {
    const value = this.objects.get(input.objectKey);
    if (!value) throw new Error(`object not found: ${input.objectKey}`);
  }
  async readObject(input: { objectKey: string }) {
    const value = this.objects.get(input.objectKey);
    if (!value) throw new Error(`object not found: ${input.objectKey}`);
    return { pipe() {} } as never;
  }
  async uploadObject(): Promise<void> {
    throw new Error("not used");
  }
  async presignDownloadObject(): Promise<never> {
    throw new Error("not used");
  }
  async headObject(input: { objectKey: string }) {
    if (!this.objects.has(input.objectKey)) throw new Error("object not found");
    return { sizeBytes: "1" };
  }
  async deleteObject(input: { objectKey: string }) {
    this.objects.delete(input.objectKey);
    this.deletedKeys.push(input.objectKey);
  }
  async createMultipartUpload(): Promise<never> {
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

describe("source retention (SEG-DEC-006a)", () => {
  let dataSource: DataSource;
  let storage: RetentionStorage;
  let processor: SourceRetentionProcessor;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    storage = new RetentionStorage();
    const audit = new AuditService(dataSource.getRepository(AuditLogEntity));
    processor = new SourceRetentionProcessor(dataSource, storage, audit);
    await dataSource.getRepository(TeamEntity).save({ id: "TEAM-RET", name: "归档团队" });
    await dataSource.getRepository(UserEntity).save({
      id: "U-RET-ADMIN",
      displayName: "归档管理员",
      username: "ret-admin",
      usernameNormalized: "ret-admin",
      passwordHash: "unused",
      role: "admin",
      status: "active",
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function seedSubmission(id: string, objectKey: string) {
    await dataSource.getRepository(SubmissionEntity).save({
      id,
      ownerId: "U-RET-ADMIN",
      teamId: "TEAM-RET",
      originalFileName: `${id}.mp4`,
      contentType: "video/mp4",
      expectedSizeBytes: "12",
      checksumSha256: "c".repeat(64),
      objectKey,
      uploadStatus: "uploaded",
      processingStatus: "completed",
      storageStatus: "available",
      assetStatus: "active",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: id,
      durationSeconds: "10.000",
      width: 1280,
      height: 720,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: "12",
      rawProbe: {},
    });
  }

  async function seedReadyAsset(submissionId: string, runId: string) {
    await dataSource.getRepository(AnnotationRunEntity).save({
      id: runId,
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
      reviewStatus: "not_required",
      publicationStatus: "auto_accepted",
      normalizedResult: { status: "candidate" },
      autoEligibility: "eligible",
      autoGateVersion: "annotation_auto_gate_v1",
      autoGateIssues: [],
      wouldAutoAccept: true,
      autoAcceptEnabledSnapshot: true,
      autoGateEvaluatedAt: new Date(),
      queuedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
    });
    await dataSource.getRepository(TaskSegmentAssetEntity).save({
      id: `TSA-RET-${runId}`,
      submissionId,
      annotationRunId: runId,
      taskIndex: 0,
      pipelineVersion: "ego_video_annotation_pipeline_v2",
      promptVersion: "ego_video_annotation_prompt_v2",
      schemaVersion: "ego_video_annotation_v2",
      evidencePolicyVersion: "ego_annotation_evidence_policy_v3",
      taskLabel: "测试任务",
      taskVerb: "pick_and_place",
      completion: "complete",
      resultStatus: "success",
      sourceStartMs: 0,
      sourceEndMs: 4_000,
      clipStartMs: 0,
      clipEndMs: 4_000,
      coverageSnapshot: {},
      evidenceSnapshot: {},
      validationWarnings: [],
      sourceObjectKey: `uploads/${submissionId}.mp4`,
      sourceSha256: "c".repeat(64),
      clipObjectKey: `task-segments/demo/${submissionId}/${runId}/task-0.mp4`,
      clipSha256: createHash("sha256").update("clip").digest("hex"),
      clipSizeBytes: "4",
      clipDurationMs: 4_000,
      codec: "h264",
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: true,
      generationStatus: "ready",
      attemptCount: 1,
      usageStatus: "internal_only",
      generationPolicyVersion: "task_segment_v1_policy_v1",
      startedAt: new Date(),
      completedAt: new Date(),
    });
  }

  it("skips submissions without any task segment asset (conservative)", async () => {
    await seedSubmission("SUB-RET-NONE", "uploads/ret-none.mp4");
    storage.objects.set("uploads/ret-none.mp4", Buffer.from("source"));
    await expect(processor.process({ submissionId: "SUB-RET-NONE", reason: "settlement:TEST" })).resolves.toBe("skipped");
    expect(storage.objects.has("uploads/ret-none.mp4")).toBe(true);
    const submission = await dataSource.getRepository(SubmissionEntity).findOneByOrFail({ id: "SUB-RET-NONE" });
    expect(submission.storageStatus).toBe("available");
  });

  it("defers archive while segment generation is still in flight", async () => {
    await seedSubmission("SUB-RET-BUSY", "uploads/ret-busy.mp4");
    storage.objects.set("uploads/ret-busy.mp4", Buffer.from("source"));
    await seedReadyAsset("SUB-RET-BUSY", "RUN-RET-BUSY");
    const asset = await dataSource.getRepository(TaskSegmentAssetEntity).findOneByOrFail({
      annotationRunId: "RUN-RET-BUSY",
    });
    asset.generationStatus = "queued";
    await dataSource.getRepository(TaskSegmentAssetEntity).save(asset);
    await expect(processor.process({ submissionId: "SUB-RET-BUSY", reason: "settlement:TEST" })).rejects.toBeInstanceOf(
      RetryableSourceRetentionError,
    );
    expect(storage.objects.has("uploads/ret-busy.mp4")).toBe(true);
  });

  it("archives the source object after settlement when all segments are final", async () => {
    await seedSubmission("SUB-RET-READY", "uploads/ret-ready.mp4");
    storage.objects.set("uploads/ret-ready.mp4", Buffer.from("source"));
    await seedReadyAsset("SUB-RET-READY", "RUN-RET-READY");
    storage.objects.set(
      "task-segments/demo/SUB-RET-READY/RUN-RET-READY/task-0.mp4",
      Buffer.from("clip"),
    );

    await expect(processor.process({ submissionId: "SUB-RET-READY", reason: "settlement:TEST" })).resolves.toBe("archived");
    expect(storage.objects.has("uploads/ret-ready.mp4")).toBe(false);
    expect(storage.objects.has("task-segments/demo/SUB-RET-READY/RUN-RET-READY/task-0.mp4")).toBe(true);
    const submission = await dataSource.getRepository(SubmissionEntity).findOneByOrFail({ id: "SUB-RET-READY" });
    expect(submission.storageStatus).toBe("deleted");
    expect(submission.storageDeletedAt).not.toBeNull();
    const audits = await dataSource.getRepository(AuditLogEntity).findBy({
      action: "submission.source_archived",
    });
    expect(audits.some((log) => log.targetAccountId === "SUB-RET-READY")).toBe(true);

    // 幂等：重复处理返回 already_deleted
    await expect(processor.process({ submissionId: "SUB-RET-READY", reason: "settlement:TEST" })).resolves.toBe("already_deleted");
  });
});