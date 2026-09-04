import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { DataSource } from "typeorm";
import { createDataSource } from "../src/database/data-source.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { TaskSegmentAssetEntity } from "../src/database/entities/task-segment-asset.entity.js";
import { TaskSegmentAnnotationRevisionEntity } from "../src/database/entities/task-segment-annotation-revision.entity.js";
import { JobOutboxEntity } from "../src/database/entities/job-outbox.entity.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { AuditService } from "../src/audit/audit.service.js";
import type { PublicUser } from "../src/auth/auth.types.js";
import { MinioObjectStorageService } from "../src/storage/minio-object-storage.service.js";
import { TaskSegmentService } from "../src/task-segment/task-segment.service.js";
import { TaskSegmentProcessor } from "../src/task-segment/task-segment.processor.js";
import { TaskSegmentMediaTool } from "../src/task-segment/task-segment-media.js";
import { TaskSegmentAnnotationService } from "../src/task-segment/task-segment-annotation.service.js";
import { SourceRetentionProcessor } from "../src/task-segment/source-retention.processor.js";
import { canonicalSegmentJson, segmentJsonSha256, validateSegmentAnnotation } from "../src/task-segment/task-segment-annotation.js";
import { runMediaCommand } from "../src/media/media-command-runner.js";
import { RabbitMediaWorker } from "../src/media/rabbit-media-worker.js";
import { RabbitMqMessageBusService } from "../src/messaging/rabbitmq-message-bus.service.js";
import { TASK_SEGMENT_ANNOTATION_ROUTING_KEY } from "../src/messaging/rabbitmq-topology.js";
import { segmentAnnotationFixture } from "./fixtures/task-segment-annotation.js";
import { TaskAssetService } from "../src/task-asset/task-asset.service.js";
import { TaskSegmentAssetProjectionEntity } from "../src/database/entities/task-segment-asset-projection.entity.js";
import { AnnotationReviewEntity } from "../src/database/entities/annotation-review.entity.js";
import { backfillTaskAssetProjections } from "../src/task-asset/task-asset-projection-backfill.js";

// Opt-in only: database-safety.ts independently checks the physical DB before
// every connection. Use a disposable MinIO endpoint and RabbitMQ instance.
const smoke = process.env.TASK_SEGMENT_SMOKE_ENDPOINT ? describe : describe.skip;
const admin: PublicUser = { id: "SMOKE-ADMIN", username: "smoke-admin", displayName: "smoke", role: "admin", status: "active", updatedAt: 0 };

class SmokeStorage extends MinioObjectStorageService {
  failJsonUpload = false;
  readonly deleted: string[] = [];
  override async uploadObject(input: Parameters<MinioObjectStorageService["uploadObject"]>[0]) {
    if (this.failJsonUpload && input.contentType === "application/json") throw new Error("injected upload failure");
    return super.uploadObject(input);
  }
  override async deleteObject(input: { objectKey: string }) {
    await super.deleteObject(input);
    this.deleted.push(input.objectKey);
  }
}

smoke("real PostgreSQL / MinIO / FFmpeg segment JSON smoke", () => {
  let ds: DataSource;
  let storage: SmokeStorage;
  let directory: string;
  let sourcePath: string;
  let sourceSha: string;
  let sourceSize: number;
  const media = new TaskSegmentMediaTool();
  let segments: TaskSegmentService;
  let processor: TaskSegmentProcessor;
  let publisher: TaskSegmentAnnotationService;
  let retention: SourceRetentionProcessor;

  beforeAll(async () => {
    vi.stubEnv("TASK_BOUNDARY_REFINEMENT_ENABLED", "false");
    const bucket = `ego-task-segment-smoke-${randomUUID()}`;
    storage = new SmokeStorage(bucket, {
      endpoint: process.env.TASK_SEGMENT_SMOKE_ENDPOINT!,
      accessKey: process.env.TASK_SEGMENT_SMOKE_ACCESS_KEY!, secretKey: process.env.TASK_SEGMENT_SMOKE_SECRET_KEY!,
    });
    ds = createDataSource(process.env.TEST_DATABASE_URL);
    await ds.initialize();
    console.log("smoke target", { database: (await ds.query("SELECT current_database() AS name"))[0].name, bucket });
    await ds.dropDatabase();
    await ds.runMigrations();
    await ds.getRepository(TeamEntity).save({ id: "SMOKE-TEAM", name: "smoke" });
    await ds.getRepository(UserEntity).save({ id: admin.id, displayName: "smoke", username: admin.username,
      usernameNormalized: admin.username, passwordHash: "unused", role: "admin", status: "active" });
    directory = await mkdtemp(join(tmpdir(), "ego-segment-json-smoke-"));
    sourcePath = join(directory, "source.mp4");
    await runMediaCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      "testsrc2=size=320x180:rate=30:duration=60", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=60",
      "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-c:a", "aac", "-movflags", "+faststart", "-y", sourcePath]);
    const bytes = await readFile(sourcePath);
    sourceSha = segmentJsonSha256(bytes);
    sourceSize = bytes.length;
    segments = new TaskSegmentService(ds, storage);
    processor = new TaskSegmentProcessor(ds, storage, media);
    publisher = new TaskSegmentAnnotationService(ds, storage);
    retention = new SourceRetentionProcessor(ds, storage, new AuditService(ds.getRepository(AuditLogEntity)));
  }, 120000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (ds?.isInitialized) await ds.destroy();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function ready(caseName: string): Promise<TaskSegmentAssetEntity> {
    const fixture = segmentAnnotationFixture(`SMOKE-${caseName}`);
    const document = fixture.run.normalizedResult as any;
    for (const snapshot of [document.raw, document.effective]) {
      if (caseName === "B") {
        snapshot.tasks[0].start_ms = 40533;
        snapshot.coverage_segments[0].start_ms = 40533;
      }
      if (caseName === "C") snapshot.tasks[0].result_evidence_timestamps_ms = [52000];
    }
    await ds.getRepository(SubmissionEntity).save({ id: fixture.asset.submissionId, ownerId: admin.id, teamId: "SMOKE-TEAM",
      originalFileName: "synthetic.mp4", contentType: "video/mp4", expectedSizeBytes: String(sourceSize), checksumSha256: sourceSha,
      objectKey: fixture.asset.sourceObjectKey, uploadStatus: "uploaded", processingStatus: "completed", storageStatus: "available" });
    await ds.getRepository(MediaMetadataEntity).save({ submissionId: fixture.asset.submissionId, durationSeconds: "60.000",
      width: 320, height: 180, frameRate: "30", codec: "h264", sizeBytes: String(sourceSize), rawProbe: { streams: [{ codec_type: "audio" }] } });
    await ds.getRepository(AnnotationRunEntity).save(fixture.run);
    await storage.uploadObject({ objectKey: fixture.asset.sourceObjectKey, sourcePath, contentType: "video/mp4" });
    expect(await segments.generate(admin, fixture.run.id)).toMatchObject({ created: 1, skipped: 0 });
    let asset = await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ annotationRunId: fixture.run.id });
    if (caseName === "E") {
      // Represents a pre-existing layout, before JSON publication. No publisher
      // operation is permitted to move or rewrite these video bytes.
      await ds.getRepository(TaskSegmentAssetEntity).update(asset.id, {
        clipObjectKey: `task-segments/demo/${asset.submissionId}/${asset.annotationRunId}/task-0.mp4`,
        storageLayoutVersion: "legacy_task_segment_layout_v0",
      });
    }
    expect(await processor.process({ assetId: asset.id })).toBe("ready");
    asset = await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: asset.id });
    expect(asset).toMatchObject({ generationStatus: "ready", validationStatus: "passed", annotationPublicationStatus: "pending" });
    expect(await ds.getRepository(JobOutboxEntity).countBy({ aggregateId: asset.id, eventType: TASK_SEGMENT_ANNOTATION_ROUTING_KEY, status: "pending" })).toBe(1);
    return asset;
  }

  it.each(["A", "B", "C", "D", "E", "F", "G"])("Asset library acceptance %s: real DB / MP4 / published JSON", async caseName => {
    const asset = await ready(`LIB-${caseName}`);
    const library = new TaskAssetService(ds);
    const run = await ds.getRepository(AnnotationRunEntity).findOneByOrFail({ id: asset.annotationRunId });
    const normalized = run.normalizedResult as any;
    if (caseName === "A") {
      normalized.labelMappings = normalized.labelMappings.filter((v: { type: string }) => v.type !== "action");
      normalized.labelMappings.push({ type: "action", sourceText: "清洗杯子", status: "matched", labelId: "TASK-WASH", labelName: "清洗杯子", confidence: 0.9 },
        { type: "object", sourceText: "海绵", status: "matched", labelId: "TOOL-SPONGE", labelName: "海绵", confidence: 0.9 });
    }
    if (caseName === "B") {
      normalized.labelMappings = [{ type: "scene", sourceText: "家庭厨房", status: "proposed", labelId: null, labelName: null, confidence: 0.9 }];
      normalized.effective.tasks[0].result_status = "unknown";
      normalized.effective.tasks[0].completion = "uncertain";
    }
    if (caseName === "C") {
      run.publicationStatus = "human_verified"; run.reviewStatus = "accepted_corrected"; run.reviewRevision = 1;
      run.humanResult = { ...structuredClone(normalized), source: "human_correction" };
      await ds.getRepository(AnnotationReviewEntity).save({ id: "LIB-REVIEW-C", annotationRunId: run.id, revision: 1,
        disposition: "accepted_corrected", correctedResult: run.humanResult, reviewDurationMs: 1000, reason: "fixture human review", reviewerAccountId: admin.id, reviewerName: "smoke" });
    }
    if (caseName === "D") {
      for (const snapshot of [normalized.raw, normalized.effective]) {
        snapshot.tasks.push(structuredClone(snapshot.tasks[0]));
        snapshot.coverage_segments.push({ ...snapshot.coverage_segments[0], linked_task_index: 1 });
      }
    }
    await ds.getRepository(AnnotationRunEntity).save(run);
    expect(await publisher.process({ assetId: asset.id })).toBe("published");
    const scope = { sourceGroupId: asset.submissionId };
    const before = await library.list(admin, scope);
    expect(before.items[0]?.currentAnnotationRevisionId).toBeTruthy();
    if (caseName === "A") expect(before.items[0]).toMatchObject({ hasUnmappedLabels: false, resultStatus: "success" });
    if (caseName === "B") expect(before.items[0]).toMatchObject({ scene: { mappingStatus: "proposed", id: null }, hasUnmappedLabels: true, resultStatus: "unknown", hasUncertainty: true });
    if (caseName === "C") expect(before.items[0]).toMatchObject({ semanticVerification: "human_verified", sourceAnnotationAcceptance: "human" });
    if (caseName === "A") expect((await library.list(admin, { ...scope, sceneKeys: "label:SCENE-001",
      taskLabelIds: "TASK-WASH", objectLabelIds: "OBJ-CUP", toolLabelIds: "TOOL-SPONGE" })).summary.assetCount).toBe(1);
    if (caseName === "B") expect((await library.list(admin, { ...scope, sceneMappingStatuses: "proposed",
      hasUnmappedLabels: "true", q: "海绵", resultStatuses: "unknown" })).summary.assetCount).toBe(1);
    if (caseName === "C") expect((await library.list(admin, { ...scope, semanticVerifications: "human_verified" })).summary.humanVerifiedCount).toBe(1);
    if (caseName === "D") {
      await segments.generate(admin, run.id);
      const second = await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ annotationRunId: run.id, taskIndex: 1 });
      expect(await processor.process({ assetId: second.id })).toBe("ready");
      expect(await publisher.process({ assetId: second.id })).toBe("published");
      const inventory = await library.sceneSummary(admin, scope);
      expect(inventory.totals).toMatchObject({ assetCount: 2, sourceGroupCount: 1, totalSegmentDurationMs: asset.clipDurationMs! + (await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: second.id })).clipDurationMs! });
    }
    if (caseName === "E") {
      await ds.getRepository(AnnotationRunEntity).update(run.id, { publicationStatus: "superseded" });
      const replacement = await ds.getRepository(AnnotationRunEntity).save({ ...run, id: "LIB-REPLACEMENT-E", trigger: "manual" });
      await segments.generate(admin, replacement.id);
      const second = await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ annotationRunId: replacement.id, taskIndex: 0 });
      expect(await processor.process({ assetId: second.id })).toBe("ready");
      expect(await publisher.process({ assetId: second.id })).toBe("published");
      const current = await library.list(admin, scope);
      expect(current.items.map(v => v.assetId)).toEqual([second.id]);
      const historical = await library.list(admin, { ...scope, includeHistorical: "true" });
      expect(historical.summary.assetCount).toBe(2);
      expect(historical.items.find(v => v.assetId === asset.id)?.isCurrent).toBe(false);
    }
    if (caseName === "F") {
      const revisionId = before.items[0]!.currentAnnotationRevisionId;
      await ds.getRepository(TaskSegmentAssetProjectionEntity).delete(asset.id);
      expect((await library.list(admin, scope)).items).toEqual([]);
      expect(await backfillTaskAssetProjections(ds, { dryRun: false, limit: 1000 })).toMatchObject({ created: 1, failed: 0 });
      expect((await library.list(admin, scope)).items[0]?.currentAnnotationRevisionId).toBe(revisionId);
    }
    if (caseName === "G") {
      expect(await retention.process({ submissionId: asset.submissionId, reason: "isolated-library-smoke" })).toBe("archived");
      await expect(storage.headObject({ objectKey: asset.sourceObjectKey })).rejects.toThrow();
      expect((await library.list(admin, scope)).summary.assetCount).toBe(1);
      expect((await library.facets(admin, scope)).scenes).toHaveLength(1);
      expect((await library.sceneSummary(admin, scope)).totals.assetCount).toBe(1);
      expect(await library.exportCsv(admin, scope)).toContain(asset.id);
      expect((await library.list(admin, { ...scope, sceneKeys: "label:SCENE-001", objectLabelIds: "OBJ-CUP", taskVerbs: "wash_or_rinse" })).summary.assetCount).toBe(1);
    }
    // All seven cases still resolve independent MP4 + JSON objects.
    const preview = await segments.preview(admin, asset.id);
    expect(segmentJsonSha256(Buffer.from(await (await fetch(preview.url)).arrayBuffer()))).toBe(asset.clipSha256);
    const json = await publisher.download(admin, asset.id, 1);
    expect((await fetch(json.url)).status).toBe(200);
    expect((await publisher.current(admin, asset.id)).currentRevision?.contentJson).toBeTruthy();
    console.log("TASK_ASSET_ACCEPTANCE", JSON.stringify({ case: caseName, sourceGroupId: asset.submissionId, assetCount: (await library.list(admin, scope)).summary.assetCount, mp4AndJsonReadable: true }));
  }, 120000);

  it.each(["A", "B", "C", "D", "E", "F"])("Case %s: independent paired assets", async caseName => {
    const asset = await ready(caseName);
    const originalRun = canonicalSegmentJson(await ds.query("SELECT row_to_json(r) AS r FROM annotation_runs r WHERE id = $1", [asset.annotationRunId]));
    const beforeVideo = await storage.presignDownloadObject({ objectKey: asset.clipObjectKey!, expiresInSeconds: 900 });
    const videoBytes = Buffer.from(await (await fetch(beforeVideo.url)).arrayBuffer());
    expect(segmentJsonSha256(videoBytes)).toBe(asset.clipSha256);

    if (caseName === "D") {
      storage.failJsonUpload = true;
      await expect(publisher.process({ assetId: asset.id })).rejects.toThrow("SEGMENT_JSON_UPLOAD_FAILED");
      expect(await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: asset.id })).toMatchObject({ generationStatus: "ready", annotationPublicationStatus: "failed" });
      await expect(retention.process({ submissionId: asset.submissionId, reason: "smoke" })).rejects.toThrow();
      await expect(storage.headObject({ objectKey: asset.sourceObjectKey })).resolves.toBeDefined();
      storage.failJsonUpload = false;
      await publisher.retry(admin, asset.id);
    }
    if (caseName === "E") {
      await storage.deleteObject({ objectKey: asset.sourceObjectKey });
      await ds.getRepository(SubmissionEntity).update(asset.submissionId, { storageStatus: "deleted" });
      expect(await publisher.backfill({ dryRun: true, limit: 100 })).toMatchObject({ eligible: 1, enqueued: 0 });
      expect(await publisher.backfill({ dryRun: false, limit: 100 })).toMatchObject({ enqueued: 1 });
    }
    if (caseName === "A") {
      const worker = new RabbitMediaWorker({ process: async () => { throw new Error("Unexpected media probe"); } } as never, undefined, undefined, undefined, publisher);
      const bus = new RabbitMqMessageBusService(process.env.RABBITMQ_URL!);
      try {
        await worker.start(process.env.RABBITMQ_URL!);
        const event = await ds.getRepository(JobOutboxEntity).findOneByOrFail({ aggregateId: asset.id, eventType: TASK_SEGMENT_ANNOTATION_ROUTING_KEY });
        await bus.publish({ messageId: event.id, routingKey: event.eventType, payload: event.payload });
        await vi.waitFor(async () => expect((await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: asset.id })).annotationPublicationStatus).toBe("published"), { timeout: 15000, interval: 100 });
      } finally { await worker.close(); await bus.close(); }
    } else expect(await publisher.process({ assetId: asset.id })).toBe("published");

    const current = await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: asset.id });
    const revision = await ds.getRepository(TaskSegmentAnnotationRevisionEntity).findOneByOrFail({ id: current.currentAnnotationRevisionId! });
    const download = await publisher.download(admin, asset.id, 1);
    const jsonResponse = await fetch(download.url);
    expect(jsonResponse.status).toBe(200);
    const jsonBytes = Buffer.from(await jsonResponse.arrayBuffer());
    expect(segmentJsonSha256(jsonBytes)).toBe(revision.jsonSha256);
    expect(revision.videoSha256).toBe(asset.clipSha256);
    const doc = validateSegmentAnnotation(JSON.parse(jsonBytes.toString()), { assetId: asset.id, revision: 1, videoSha256: asset.clipSha256! });
    expect(doc.task.evidence_timestamps_ms[0]).toBe(42000 - asset.actualStartMs!);
    expect(doc.provenance.source_sha256).toBe(sourceSha);
    expect(doc.scene.verification).toBe("inherited_from_published_annotation");
    if (caseName === "A") expect(asset.materializationMode).toBe("exact_clip_transcode");
    if (caseName === "B") {
      expect(asset.materializationMode).toBe("stream_copy");
      expect(asset.actualStartMs).not.toBe(asset.requestedStartMs);
      expect(doc.task.evidence_timestamps_ms[0]).not.toBe(42000 - asset.requestedStartMs);
    }
    if (caseName === "C") {
      expect(asset.requestedEndMs).toBe(52500);
      expect(doc.task.result.evidence_timestamps_ms[0]).toBe(52000 - asset.actualStartMs!);
    }
    const copyPath = join(directory, `${caseName}-download.mp4`);
    await storage.downloadObject({ objectKey: asset.clipObjectKey!, destinationPath: copyPath });
    await media.assertFullyDecodable(copyPath);
    let cleanup: string[] = [];
    if (caseName === "F") {
      const thumbnail = join(directory, "thumbnail.jpg");
      await runMediaCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", sourcePath, "-frames:v", "1", "-y", thumbnail]);
      await runMediaCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", sourcePath, "-c", "copy", "-f", "hls", "-hls_time", "10", "-hls_list_size", "0", "-y", join(directory, "master.m3u8")]);
      const hlsFiles = (await readdir(directory)).filter(name => name.endsWith(".ts") || name.endsWith(".m3u8"));
      const prefix = `derived/${asset.submissionId}`;
      for (const name of hlsFiles) await storage.uploadObject({ objectKey: `${prefix}/${name}`, sourcePath: join(directory, name), contentType: name.endsWith(".ts") ? "video/mp2t" : "application/vnd.apple.mpegurl" });
      await storage.uploadObject({ objectKey: `${prefix}/preview.mp4`, sourcePath, contentType: "video/mp4" });
      await storage.uploadObject({ objectKey: `${prefix}/thumbnail.jpg`, sourcePath: thumbnail, contentType: "image/jpeg" });
      const derived = [`${prefix}/thumbnail.jpg`, `${prefix}/preview.mp4`, `${prefix}/master.m3u8`, ...hlsFiles.map(name => `${prefix}/${name}`)];
      await ds.getRepository(MediaMetadataEntity).update(asset.submissionId, { thumbnailObjectKey: derived[0], previewObjectKey: derived[1], hlsMasterObjectKey: derived[2], hlsObjectKeys: hlsFiles.map(name => `${prefix}/${name}`) });
      storage.deleted.length = 0;
      expect(await retention.process({ submissionId: asset.submissionId, reason: "isolated-smoke" })).toBe("archived");
      cleanup = storage.deleted.slice();
      expect(cleanup.at(-1)).toBe(asset.sourceObjectKey);
      for (const key of new Set([...derived, asset.sourceObjectKey])) await expect(storage.headObject({ objectKey: key })).rejects.toThrow();
      expect((await segments.get(admin, asset.id)).asset.generationStatus).toBe("ready");
      expect((await fetch((await publisher.download(admin, asset.id, 1)).url)).status).toBe(200);
      const preview = await segments.preview(admin, asset.id);
      expect(segmentJsonSha256(Buffer.from(await (await fetch(preview.url)).arrayBuffer()))).toBe(asset.clipSha256);
      expect(doc.task.description).toBeTruthy();
      expect(doc.task.tools).not.toHaveLength(0);
      expect(doc.task.atomic_actions).not.toHaveLength(0);
      expect(doc.task.result.evidence_timestamps_ms).not.toHaveLength(0);
      expect(doc.provenance.source_submission_id).toBe(asset.submissionId);
      expect(await retention.process({ submissionId: asset.submissionId, reason: "repeat" })).toBe("already_deleted");
    }
    expect(canonicalSegmentJson(await ds.query("SELECT row_to_json(r) AS r FROM annotation_runs r WHERE id = $1", [asset.annotationRunId]))).toBe(originalRun);
    expect((await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: asset.id })).clipObjectKey).toBe(asset.clipObjectKey);
    console.log("SEGMENT_SMOKE_RESULT", JSON.stringify({ case: caseName, assetId: asset.id, mode: asset.materializationMode,
      requestedStartMs: asset.requestedStartMs, actualStartMs: asset.actualStartMs, actualEndMs: asset.actualEndMs,
      revision: revision.revision, videoSha256: asset.clipSha256, jsonSha256: revision.jsonSha256,
      mp4ObjectKey: asset.clipObjectKey, jsonObjectKey: revision.jsonObjectKey, sourceSha256: sourceSha, cleanup }));
  }, 120000);
});
