import { Readable } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import { vi } from "vitest";
import type { DataSource } from "typeorm";
import { createDataSource } from "../src/database/data-source.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { TaskSegmentAssetEntity } from "../src/database/entities/task-segment-asset.entity.js";
import { TaskSegmentAnnotationRevisionEntity } from "../src/database/entities/task-segment-annotation-revision.entity.js";
import { JobOutboxEntity } from "../src/database/entities/job-outbox.entity.js";
import { PointCycleEntity } from "../src/database/entities/point-cycle.entity.js";
import { PointCycleItemEntity } from "../src/database/entities/point-cycle-item.entity.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";
import { VideoQualityPromptVersionEntity } from "../src/database/entities/video-quality-prompt-version.entity.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { PublicUser } from "../src/auth/auth.types.js";
import type { ObjectStoragePort } from "../src/storage/object-storage.port.js";
import { TaskSegmentAnnotationService } from "../src/task-segment/task-segment-annotation.service.js";
import { SourceRetentionProcessor } from "../src/task-segment/source-retention.processor.js";
import { canonicalSegmentJson, segmentJsonSha256, taskSegmentAnnotationSchema } from "../src/task-segment/task-segment-annotation.js";
import { TaskSegmentAnnotationPublication2026091200001 } from "../src/database/migrations/202609120001-task-segment-annotation-publication.js";
import { segmentAnnotationFixture } from "./fixtures/task-segment-annotation.js";
import { TaskSegmentAssetProjectionEntity } from "../src/database/entities/task-segment-asset-projection.entity.js";
import { TaskAssetProjection2026091300001 } from "../src/database/migrations/202609130001-task-asset-projection.js";

export class AnnotationTestStorage implements ObjectStoragePort {
  objects = new Map<string, Buffer>();
  uploads: string[] = [];
  deletes: string[] = [];
  failUpload = false;
  failHeadKey: string | null = null;
  corruptRead = false;
  failDeleteKey: string | null = null;
  onUpload: (() => Promise<void>) | null = null;
  async downloadObject(input: { objectKey: string; destinationPath: string }) {
    await writeFile(input.destinationPath, this.get(input.objectKey));
  }
  get(key: string): Buffer {
    const bytes = this.objects.get(key);
    if (!bytes) throw Object.assign(new Error("not found"), { name: "NotFound" });
    return bytes;
  }
  async readObject(input: { objectKey: string }) {
    const bytes = this.get(input.objectKey);
    return Readable.from(this.corruptRead ? Buffer.alloc(bytes.length, 32) : bytes);
  }
  async uploadObject(input: { objectKey: string; sourcePath: string }) {
    if (this.failUpload) throw new Error("Authorization: never-copy-this-to-errors /private/local-file");
    this.objects.set(input.objectKey, await readFile(input.sourcePath));
    this.uploads.push(input.objectKey);
    if (this.onUpload) await this.onUpload();
  }
  async headObject(input: { objectKey: string }) {
    if (input.objectKey === this.failHeadKey) throw new Error("storage unavailable");
    return { sizeBytes: String(this.get(input.objectKey).length) };
  }
  async deleteObject(input: { objectKey: string }) {
    if (input.objectKey === this.failDeleteKey) throw new Error("delete failed");
    this.deletes.push(input.objectKey);
    this.objects.delete(input.objectKey);
  }
  async presignDownloadObject(input: { objectKey: string }) {
    return { url: `https://storage.test/${input.objectKey}`, expiresAt: new Date(Date.now() + 900000) };
  }
  async createMultipartUpload(): Promise<never> { throw new Error("unused"); }
  async presignUploadPart(): Promise<never> { throw new Error("unused"); }
  async completeMultipartUpload(): Promise<never> { throw new Error("unused"); }
  async abortMultipartUpload() {}
}

const admin: PublicUser = { id: "JSON-ADMIN", displayName: "test", username: "json-admin", role: "admin", status: "active", updatedAt: 0 };
let sequence = 0;
describe("segment annotation publication / retention / backfill", () => {
  let ds: DataSource;
  let storage: AnnotationTestStorage;
  let service: TaskSegmentAnnotationService;
  let retention: SourceRetentionProcessor;
  let fixture: ReturnType<typeof segmentAnnotationFixture>;

  beforeAll(async () => {
    ds = createDataSource(process.env.TEST_DATABASE_URL);
    await ds.initialize();
    console.log("disposable database:", (await ds.query("SELECT current_database() AS name"))[0].name);
    await ds.dropDatabase();
    await ds.runMigrations();
    await ds.getRepository(TeamEntity).save({ id: "JSON-TEAM", name: "test" });
    await ds.getRepository(UserEntity).save({ id: admin.id, displayName: "test", username: "json-admin",
      usernameNormalized: "json-admin", passwordHash: "unused", role: "admin", status: "active" });
  });
  afterAll(async () => { if (ds?.isInitialized) await ds.destroy(); });
  beforeEach(async () => {
    fixture = segmentAnnotationFixture(String(++sequence).padStart(4, "0"));
    storage = new AnnotationTestStorage();
    service = new TaskSegmentAnnotationService(ds, storage);
    retention = new SourceRetentionProcessor(ds, storage, new AuditService(ds.getRepository(AuditLogEntity)));
    await ds.getRepository(SubmissionEntity).save({
      id: fixture.asset.submissionId, ownerId: admin.id, teamId: "JSON-TEAM", originalFileName: "test.mp4",
      contentType: "video/mp4", expectedSizeBytes: "6", checksumSha256: fixture.asset.sourceSha256,
      objectKey: fixture.asset.sourceObjectKey, uploadStatus: "uploaded", processingStatus: "completed", storageStatus: "available",
    });
    await ds.getRepository(MediaMetadataEntity).save({
      submissionId: fixture.asset.submissionId, durationSeconds: "60.000", width: 320, height: 180,
      frameRate: "30", codec: "h264", sizeBytes: "6", rawProbe: {},
    });
    await ds.getRepository(AnnotationRunEntity).save(fixture.run);
    await ds.getRepository(TaskSegmentAssetEntity).save(fixture.asset);
    storage.objects.set(fixture.asset.sourceObjectKey, Buffer.from("source"));
    storage.objects.set(fixture.asset.clipObjectKey!, Buffer.from("clip"));
  });
  afterEach(() => vi.restoreAllMocks());
  const asset = () => ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: fixture.asset.id });
  const revisions = () => ds.getRepository(TaskSegmentAnnotationRevisionEntity).find({ where: { taskSegmentAssetId: fixture.asset.id }, order: { revision: "ASC" } });

  it("publishes exactly one immutable revision; current JSON and video are bound", async () => {
    const beforeRun = canonicalSegmentJson(fixture.run.normalizedResult);
    const parse = vi.spyOn(taskSegmentAnnotationSchema, "safeParse");
    // Finalize rebuilds/validates the source fingerprint, then validates stored
    // JSON once. Projection construction must not add a third parse.
    storage.onUpload = async () => { parse.mockClear(); };
    await expect(service.process({ assetId: fixture.asset.id })).resolves.toBe("published");
    expect(parse).toHaveBeenCalledTimes(2);
    await expect(service.process({ assetId: fixture.asset.id })).resolves.toBe("published");
    expect(parse).toHaveBeenCalledTimes(3); // Idempotent retry checks only the fingerprint.
    const rows = await revisions();
    expect(rows).toHaveLength(1);
    expect(storage.uploads).toHaveLength(1);
    expect(rows[0]!.videoSha256).toBe(fixture.asset.clipSha256);
    expect(rows[0]!.jsonSha256).toBe(segmentJsonSha256(storage.get(rows[0]!.jsonObjectKey)));
    expect((await asset()).currentAnnotationRevisionId).toBe(rows[0]!.id);
    expect(await ds.getRepository(TaskSegmentAssetProjectionEntity).findOneByOrFail({ assetId: fixture.asset.id })).toMatchObject({ currentAnnotationRevisionId: rows[0]!.id, sceneGroupKey: "label:SCENE-001" });
    expect((await service.current(admin, fixture.asset.id)).currentRevision?.contentJson).toEqual(rows[0]!.contentJson);
    expect((await service.download(admin, fixture.asset.id, 1)).jsonSha256).toBe(rows[0]!.jsonSha256);
    expect((await service.revisions(admin, fixture.asset.id)).revisions[0]?.isCurrent).toBe(true);
    const afterRun = await ds.getRepository(AnnotationRunEntity).findOneByOrFail({ id: fixture.run.id });
    expect(canonicalSegmentJson(afterRun.normalizedResult)).toBe(beforeRun);
    expect(storage.get(fixture.asset.clipObjectKey!)).toEqual(Buffer.from("clip"));
    await expect(ds.getRepository(TaskSegmentAnnotationRevisionEntity).update(rows[0]!.id, { canonicalJson: "{}" })).rejects.toThrow("immutable");
  });

  it("serializes concurrent consumers and keeps revisions/uploads unique", async () => {
    const outcomes = await Promise.allSettled([service.process({ assetId: fixture.asset.id }), service.process({ assetId: fixture.asset.id })]);
    expect(outcomes.some(r => r.status === "fulfilled" && r.value === "published")).toBe(true);
    await service.process({ assetId: fixture.asset.id });
    expect(await revisions()).toHaveLength(1);
    expect(storage.uploads).toHaveLength(1);
  });

  it("retries an upload failure without touching video or exposing secrets", async () => {
    storage.failUpload = true;
    await expect(service.process({ assetId: fixture.asset.id })).rejects.toThrow("SEGMENT_JSON_UPLOAD_FAILED");
    const reserved = (await revisions())[0]!;
    expect(await asset()).toMatchObject({ generationStatus: "ready", annotationPublicationStatus: "failed", currentAnnotationRevisionId: null,
      annotationPublicationFailureMessage: "SEGMENT_JSON_UPLOAD_FAILED" });
    await expect(retention.process({ submissionId: fixture.asset.submissionId, reason: "test" })).rejects.toThrow();
    expect(storage.deletes).toHaveLength(0);
    await expect(service.download(admin, fixture.asset.id, 1)).rejects.toThrow();
    storage.failUpload = false;
    await service.retry(admin, fixture.asset.id);
    await service.process({ assetId: fixture.asset.id });
    expect(await revisions()).toHaveLength(1);
    expect((await revisions())[0]).toMatchObject({ id: reserved.id, revision: 1, sourceFingerprint: reserved.sourceFingerprint });
    expect((await revisions())[0]!.attemptCount).toBe(2);
    expect(storage.get(fixture.asset.clipObjectKey!)).toEqual(Buffer.from("clip"));
  });

  it("recovers the same bytes/revision after database finalize failure", async () => {
    const finalize = vi.spyOn(service as any, "finalize").mockRejectedValueOnce(new Error("database unavailable"));
    await expect(service.process({ assetId: fixture.asset.id })).rejects.toThrow("SEGMENT_JSON_DATABASE_FINALIZE_FAILED");
    const reserved = (await revisions())[0]!;
    expect((await service.current(admin, fixture.asset.id)).currentRevision).toBeNull();
    finalize.mockRestore();
    await service.process({ assetId: fixture.asset.id });
    expect((await revisions())[0]!.id).toBe(reserved.id);
    expect((await revisions())[0]!.canonicalJson).toBe(reserved.canonicalJson);
    expect(storage.uploads).toHaveLength(1);
  });

  it("rolls back Revision publication when the Current pointer write fails", async () => {
    await ds.query(`CREATE OR REPLACE FUNCTION fail_test_segment_pointer() RETURNS trigger AS $$
      BEGIN IF NEW.current_annotation_revision_id IS DISTINCT FROM OLD.current_annotation_revision_id THEN
      RAISE EXCEPTION 'injected pointer failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await ds.query(`CREATE TRIGGER fail_test_segment_pointer BEFORE UPDATE ON task_segment_assets
      FOR EACH ROW EXECUTE FUNCTION fail_test_segment_pointer()`);
    try {
      await expect(service.process({ assetId: fixture.asset.id })).rejects.toThrow("SEGMENT_JSON_DATABASE_FINALIZE_FAILED");
      expect((await asset()).currentAnnotationRevisionId).toBeNull();
      expect((await revisions())[0]!.publicationStatus).toBe("failed");
      expect((await revisions())[0]!.publishedAt).toBeNull();
      expect(await ds.getRepository(TaskSegmentAssetProjectionEntity).findOneBy({ assetId: fixture.asset.id })).toBeNull();
      await expect(service.download(admin, fixture.asset.id, 1)).rejects.toThrow();
    } finally {
      await ds.query("DROP TRIGGER fail_test_segment_pointer ON task_segment_assets");
      await ds.query("DROP FUNCTION fail_test_segment_pointer()");
    }
    await service.process({ assetId: fixture.asset.id });
    expect(await revisions()).toHaveLength(1);
    expect(storage.uploads).toHaveLength(1);
  });

  it("rolls back publication and pointer when projection upsert fails, then retries the same JSON", async () => {
    await ds.query(`CREATE FUNCTION fail_test_projection() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'injected projection failure'; END; $$ LANGUAGE plpgsql`);
    await ds.query(`CREATE TRIGGER fail_test_projection BEFORE INSERT OR UPDATE ON task_segment_asset_projections
      FOR EACH ROW EXECUTE FUNCTION fail_test_projection()`);
    try {
      await expect(service.process({ assetId: fixture.asset.id })).rejects.toThrow("SEGMENT_JSON_DATABASE_FINALIZE_FAILED");
      expect((await asset()).currentAnnotationRevisionId).toBeNull();
      expect((await revisions())[0]!.publicationStatus).toBe("failed");
      expect(await ds.getRepository(TaskSegmentAssetProjectionEntity).countBy({ assetId: fixture.asset.id })).toBe(0);
    } finally {
      await ds.query("DROP TRIGGER fail_test_projection ON task_segment_asset_projections");
      await ds.query("DROP FUNCTION fail_test_projection()");
    }
    await service.process({ assetId: fixture.asset.id });
    expect(await revisions()).toHaveLength(1);
    expect(storage.uploads).toHaveLength(1);
  });

  it("fails HEAD and remote SHA validation, never overwriting an existing JSON key", async () => {
    const key = `segments/${fixture.asset.id}/annotation.r0001.json`;
    storage.failHeadKey = key;
    await expect(service.process({ assetId: fixture.asset.id })).rejects.toThrow("SEGMENT_JSON_OBJECT_VERIFY_FAILED");
    storage.failHeadKey = null;
    storage.corruptRead = true;
    await expect(service.process({ assetId: fixture.asset.id })).rejects.toThrow("SEGMENT_JSON_HASH_MISMATCH");
    storage.corruptRead = false;
    await service.process({ assetId: fixture.asset.id });
    expect(storage.uploads).toHaveLength(1);
  });

  it("rejects a source change between reservation and finalize; leaves no current pointer", async () => {
    storage.onUpload = async () => {
      const run = await ds.getRepository(AnnotationRunEntity).findOneByOrFail({ id: fixture.run.id });
      const effective = (run.normalizedResult as any).effective;
      effective.tasks[0].tools = ["另一个工具"];
      await ds.getRepository(AnnotationRunEntity).save(run);
    };
    await expect(service.process({ assetId: fixture.asset.id })).resolves.toBe("failed");
    expect((await asset()).currentAnnotationRevisionId).toBeNull();
    storage.onUpload = null;
    await service.process({ assetId: fixture.asset.id });
    expect((await revisions()).map(r => r.revision)).toEqual([1, 2]);
    expect((await asset()).currentAnnotationRevisionId).toBe((await revisions())[1]!.id);
  });

  it.each(["claim", "finalize"])("rejects a superseded Run at %s without publishing old JSON or changing the replacement asset", async stage => {
    const cycleId = `SUPERSEDED-CYCLE-${sequence}`;
    await ds.getRepository(PointCycleEntity).save({ id: cycleId, businessDate: "2026-09-03", status: "settled",
      submissionCount: 1, effectiveDurationMs: "11000", totalPoints: "1", createdByAccountId: admin.id, createdByName: "test" });
    await ds.getRepository(PointCycleItemEntity).save({ id: `SUPERSEDED-ITEM-${sequence}`, cycleId,
      submissionId: fixture.asset.submissionId, ownerId: admin.id, ownerName: "test", teamId: "JSON-TEAM", teamName: "test",
      fileName: "test.mp4", finalScore: "90", settlementRatio: "1", effectiveDurationMs: "11000", pointsPerMinute: "1", points: "1", qualityRevision: 1 });
    const replacement = segmentAnnotationFixture(`REPLACEMENT-${sequence}`);
    replacement.run.trigger = "manual";
    replacement.run.submissionId = fixture.asset.submissionId;
    for (const snapshot of [(replacement.run.normalizedResult as any).raw, (replacement.run.normalizedResult as any).effective]) {
      snapshot.video_id = fixture.asset.submissionId;
    }
    replacement.asset.submissionId = fixture.asset.submissionId;
    replacement.asset.sourceObjectKey = fixture.asset.sourceObjectKey;
    replacement.asset.sourceSha256 = fixture.asset.sourceSha256;
    let replacementBefore: TaskSegmentAssetEntity;
    const supersede = async () => {
      await ds.transaction(async manager => {
        await manager.getRepository(SubmissionEntity).findOne({ where: { id: fixture.asset.submissionId }, lock: { mode: "pessimistic_write" } });
        await manager.getRepository(AnnotationRunEntity).update(fixture.run.id, { publicationStatus: "superseded" });
        await manager.getRepository(AnnotationRunEntity).save(replacement.run);
        await manager.getRepository(TaskSegmentAssetEntity).save(replacement.asset);
      });
      replacementBefore = await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: replacement.asset.id });
      storage.objects.set(replacement.asset.clipObjectKey!, Buffer.from("clip"));
    };
    if (stage === "claim") await supersede();
    else storage.onUpload = supersede;

    await expect(service.process({ assetId: fixture.asset.id })).resolves.toBe("failed");
    expect(await asset()).toMatchObject({ currentAnnotationRevisionId: null, annotationPublicationStatus: "failed",
      annotationPublicationFailureCode: "ANNOTATION_RUN_NOT_PUBLISHED" });
    expect((await service.current(admin, fixture.asset.id)).currentRevision).toBeNull();
    const rows = await revisions();
    expect(await ds.getRepository(TaskSegmentAssetProjectionEntity).findOneBy({ assetId: fixture.asset.id })).toBeNull();
    expect(rows).toHaveLength(stage === "claim" ? 0 : 1);
    if (stage === "finalize") {
      expect(rows[0]).toMatchObject({ revision: 1, publicationStatus: "failed", publishedAt: null });
      expect(storage.get(rows[0]!.jsonObjectKey)).toBeDefined();
      await expect(service.download(admin, fixture.asset.id, 1)).rejects.toThrow();
    }
    expect(await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: replacement.asset.id })).toEqual(replacementBefore!);
    expect(await ds.getRepository(JobOutboxEntity).countBy({ aggregateId: fixture.asset.submissionId,
      eventType: "submission.source.retention.v1" })).toBe(0);
    await expect(retention.process({ submissionId: fixture.asset.submissionId, reason: "superseded-run-review" })).rejects.toThrow("JSON");
    expect(storage.deletes).toHaveLength(0);
    expect(storage.get(fixture.asset.sourceObjectKey)).toBeDefined();
    expect((await ds.getRepository(SubmissionEntity).findOneByOrFail({ id: fixture.asset.submissionId })).storageStatus).toBe("available");
  });

  it("keeps a previous published revision intact when publishing a new fingerprint", async () => {
    await service.process({ assetId: fixture.asset.id });
    const previous = (await revisions())[0]!;
    const run = await ds.getRepository(AnnotationRunEntity).findOneByOrFail({ id: fixture.run.id });
    (run.normalizedResult as any).effective.tasks[0].tools = ["另一个工具"];
    await ds.getRepository(AnnotationRunEntity).save(run);
    await service.process({ assetId: fixture.asset.id });
    expect((await revisions()).map(r => r.revision)).toEqual([1, 2]);
    expect((await revisions())[0]!.canonicalJson).toBe(previous.canonicalJson);
    expect(await ds.getRepository(TaskSegmentAssetProjectionEntity).findOneByOrFail({ assetId: fixture.asset.id })).toMatchObject({ currentAnnotationRevisionId: (await revisions())[1]!.id, toolRawTexts: ["另一个工具"] });
    expect(await ds.getRepository(TaskSegmentAssetProjectionEntity).countBy({ assetId: fixture.asset.id })).toBe(1);
    expect(storage.get(fixture.asset.clipObjectKey!)).toEqual(Buffer.from("clip"));
  });

  it.each(["pending", "publishing", "failed"] as const)("retains source while JSON is %s", async state => {
    await ds.getRepository(TaskSegmentAssetEntity).update(fixture.asset.id, { annotationPublicationStatus: state });
    await expect(retention.process({ submissionId: fixture.asset.submissionId, reason: "test" })).rejects.toThrow();
    expect(storage.deletes).toHaveLength(0);
  });

  it.each(["missing", "size", "video-binding"] as const)("retains source for invalid current JSON: %s", async kind => {
    await service.process({ assetId: fixture.asset.id });
    const revision = (await revisions())[0]!;
    if (kind === "missing") storage.objects.delete(revision.jsonObjectKey);
    if (kind === "size") storage.objects.set(revision.jsonObjectKey, Buffer.from("{}"));
    if (kind === "video-binding") await ds.getRepository(TaskSegmentAssetEntity).update(fixture.asset.id, { clipSha256: "f".repeat(64) });
    await expect(retention.process({ submissionId: fixture.asset.submissionId, reason: "test" })).rejects.toThrow();
    expect(storage.get(fixture.asset.sourceObjectKey)).toBeDefined();
    expect(storage.deletes).toHaveLength(0);
  });

  it("deletes full previews first and original last; resumes partial deletion idempotently", async () => {
    await service.process({ assetId: fixture.asset.id });
    const keys = ["derived/thumb.jpg", "derived/preview.mp4", "derived/master.m3u8", "derived/segment.ts"];
    for (const key of keys) storage.objects.set(key, Buffer.from("preview"));
    await ds.getRepository(MediaMetadataEntity).update(fixture.asset.submissionId, {
      thumbnailObjectKey: keys[0], previewObjectKey: keys[1], hlsMasterObjectKey: keys[2],
      hlsObjectKeys: [keys[2]!, keys[3]!],
    });
    storage.failDeleteKey = keys[1]!;
    await expect(retention.process({ submissionId: fixture.asset.submissionId, reason: "test" })).rejects.toThrow();
    expect((await ds.getRepository(SubmissionEntity).findOneByOrFail({ id: fixture.asset.submissionId })).storageStatus).toBe("available");
    expect(storage.get(fixture.asset.sourceObjectKey)).toBeDefined();
    storage.failDeleteKey = null;
    storage.deletes = [];
    await expect(retention.process({ submissionId: fixture.asset.submissionId, reason: "test" })).resolves.toBe("archived");
    expect(storage.deletes).toEqual([...keys, fixture.asset.sourceObjectKey]);
    await expect(retention.process({ submissionId: fixture.asset.submissionId, reason: "test" })).resolves.toBe("already_deleted");
    expect(storage.get(fixture.asset.clipObjectKey!)).toBeDefined();
    expect((await service.current(admin, fixture.asset.id)).currentRevision).not.toBeNull();
  });

  it("backfills deleted-source legacy assets with bounded dry-run and no MP4 movement", async () => {
    const oldKey = `task-segments/demo/${fixture.asset.submissionId}/${fixture.run.id}/task-0.mp4`;
    storage.objects.set(oldKey, storage.get(fixture.asset.clipObjectKey!));
    storage.objects.delete(fixture.asset.clipObjectKey!);
    await ds.getRepository(TaskSegmentAssetEntity).update(fixture.asset.id, { clipObjectKey: oldKey, storageLayoutVersion: "legacy_task_segment_layout_v0" });
    await ds.getRepository(SubmissionEntity).update(fixture.asset.submissionId, { storageStatus: "deleted" });
    storage.objects.delete(fixture.asset.sourceObjectKey);
    const after = fixture.asset.id.slice(0, -4) + String(sequence - 1).padStart(4, "0");
    const beforeJobs = await ds.getRepository(JobOutboxEntity).count();
    expect(await service.backfill({ dryRun: true, limit: 1, after })).toMatchObject({ scanned: 1, eligible: 1, enqueued: 0 });
    expect(await ds.getRepository(JobOutboxEntity).count()).toBe(beforeJobs);
    expect(await service.backfill({ dryRun: false, limit: 1, after })).toMatchObject({ scanned: 1, enqueued: 1 });
    await service.process({ assetId: fixture.asset.id });
    expect((await asset()).clipObjectKey).toBe(oldKey);
    expect(storage.uploads).toEqual([`segments/${fixture.asset.id}/annotation.r0001.json`]);
    expect(await service.backfill({ dryRun: false, limit: 1, after })).toMatchObject({ alreadyPublished: 1, enqueued: 0 });
  });

  it("records a legacy evidence-outside-clip failure without clamping or replacing MP4", async () => {
    await ds.getRepository(TaskSegmentAssetEntity).update(fixture.asset.id, { actualStartMs: 43000, actualEndMs: 54000 });
    await expect(service.process({ assetId: fixture.asset.id })).resolves.toBe("failed");
    expect((await asset()).annotationPublicationFailureCode).toBe("EVIDENCE_OUTSIDE_CLIP");
    expect(storage.uploads).toHaveLength(0);
    expect(storage.get(fixture.asset.clipObjectKey!)).toEqual(Buffer.from("clip"));
  });

  it("rejects non-admin reads, downloads and retries", async () => {
    const collector = { ...admin, role: "collector" as const };
    await expect(service.current(collector, fixture.asset.id)).rejects.toThrow();
    await expect(service.revisions(collector, fixture.asset.id)).rejects.toThrow();
    await expect(service.download(collector, fixture.asset.id, 1)).rejects.toThrow();
    await expect(service.retry(collector, fixture.asset.id)).rejects.toThrow();
  });

  it("only retries ready, unpublished or stale-publishing assets", async () => {
    await ds.getRepository(TaskSegmentAssetEntity).update(fixture.asset.id, { annotationPublicationStatus: "publishing" });
    await expect(service.retry(admin, fixture.asset.id)).rejects.toThrow();
    await ds.query("UPDATE task_segment_assets SET updated_at = now() - interval '10 minutes' WHERE id = $1", [fixture.asset.id]);
    await expect(service.retry(admin, fixture.asset.id)).resolves.toMatchObject({ publicationStatus: "pending" });
    await service.process({ assetId: fixture.asset.id });
    await expect(service.retry(admin, fixture.asset.id)).rejects.toThrow();
  });

  it("wakes retention again after publication of an already settled submission", async () => {
    const cycleId = `CYCLE-${sequence}`;
    await ds.getRepository(PointCycleEntity).save({ id: cycleId, businessDate: "2026-09-03", status: "settled",
      submissionCount: 1, effectiveDurationMs: "11000", totalPoints: "1", createdByAccountId: admin.id, createdByName: "test" });
    await ds.getRepository(PointCycleItemEntity).save({ id: `ITEM-${sequence}`, cycleId,
      submissionId: fixture.asset.submissionId, ownerId: admin.id, ownerName: "test", teamId: "JSON-TEAM", teamName: "test",
      fileName: "test.mp4", finalScore: "90", settlementRatio: "1", effectiveDurationMs: "11000", pointsPerMinute: "1", points: "1", qualityRevision: 1 });
    await service.process({ assetId: fixture.asset.id });
    await service.process({ assetId: fixture.asset.id });
    expect(await ds.getRepository(JobOutboxEntity).countBy({ eventType: "submission.source.retention.v1", aggregateId: fixture.asset.submissionId })).toBe(1);
    expect((await ds.getRepository(JobOutboxEntity).findOneByOrFail({ eventType: "submission.source.retention.v1", aggregateId: fixture.asset.submissionId })).status).toBe("pending");
  });

  it("isolates QC, effective duration, settlement, quarantine, points and source annotations across all publication paths", async () => {
    await ds.getRepository(VideoQualityPromptVersionEntity).save({ id: "JSON-QC-PROMPT", revision: 99001,
      systemPrompt: "test", contentSha256: "a".repeat(64), promptVersion: "test", ruleVersion: "test", outputSchema: "test",
      initialModel: "test", reviewModel: "test", createdByAccountId: admin.id, createdByName: "test" });
    await ds.getRepository(VideoQualityResultEntity).save({ submissionId: fixture.asset.submissionId, status: "scored",
      promptVersionId: "JSON-QC-PROMPT", promptRevision: 99001, promptContentSha256: "a".repeat(64), systemPromptSnapshot: "test",
      initialModel: "test", reviewModel: "test", finalScore: "87.5", settlementRatio: "0.8", billableDurationMs: "48000" });
    await ds.getRepository(SubmissionEntity).update(fixture.asset.submissionId, { assetStatus: "quarantined" });
    const snapshot = async () => canonicalSegmentJson(await Promise.all([
      ds.query("SELECT row_to_json(q) AS row FROM video_quality_results q WHERE submission_id=$1", [fixture.asset.submissionId]),
      ds.query("SELECT row_to_json(s) AS row FROM submissions s WHERE id=$1", [fixture.asset.submissionId]),
      ds.query("SELECT row_to_json(r) AS row FROM annotation_runs r WHERE id=$1", [fixture.run.id]),
      ds.query("SELECT row_to_json(c) AS row FROM point_cycles c ORDER BY id"),
      ds.query("SELECT row_to_json(i) AS row FROM point_cycle_items i ORDER BY id"),
      ds.query("SELECT row_to_json(w) AS row FROM wallet_transactions w ORDER BY id"),
      ds.query(`SELECT source_start_ms, source_end_ms, refined_start_ms, refined_end_ms, requested_start_ms,
        requested_end_ms, actual_start_ms, actual_end_ms, clip_sha256, clip_object_key, clip_duration_ms
        FROM task_segment_assets WHERE id=$1`, [fixture.asset.id]),
    ]));
    const before = await snapshot();
    await service.backfill({ dryRun: false, limit: 100 });
    storage.failUpload = true;
    await expect(service.process({ assetId: fixture.asset.id })).rejects.toThrow();
    storage.failUpload = false;
    await service.retry(admin, fixture.asset.id);
    await service.process({ assetId: fixture.asset.id });
    await service.process({ assetId: fixture.asset.id });
    expect(await snapshot()).toBe(before);
    expect(storage.get(fixture.asset.clipObjectKey!)).toEqual(Buffer.from("clip"));
  });

  it("migration down/up leaves legacy ready assets pending, without publishing or storage writes", async () => {
    // This is last: remove current pointers/revisions by reverting only this
    // migration on the disposable DB, then apply it again.
    const migration = new TaskSegmentAnnotationPublication2026091200001();
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await new TaskAssetProjection2026091300001().down(runner);
      await migration.down(runner);
      await migration.up(runner);
      await new TaskAssetProjection2026091300001().up(runner);
      expect(await asset()).toMatchObject({ storageLayoutVersion: "legacy_task_segment_layout_v0", annotationPublicationStatus: "pending", currentAnnotationRevisionId: null });
      expect(await revisions()).toHaveLength(0);
      expect(storage.uploads).toHaveLength(0);
    } finally { await runner.release(); }
  });
});
