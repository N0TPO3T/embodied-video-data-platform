import { randomUUID } from "node:crypto";
import { upsertTaskAssetProjection } from "../task-asset/task-asset-projection.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import type { PublicUser } from "../auth/auth.types.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { AnnotationReviewEntity } from "../database/entities/annotation-review.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { TaskBoundaryRefinementEntity } from "../database/entities/task-boundary-refinement.entity.js";
import { TaskSegmentAssetEntity } from "../database/entities/task-segment-asset.entity.js";
import { TaskSegmentAnnotationRevisionEntity } from "../database/entities/task-segment-annotation-revision.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { acceptedAnnotationRun } from "../delivery/delivery-annotation.js";
import { OperationsFailure } from "../operations/operations-failure.js";
import { OBJECT_STORAGE, type ObjectStoragePort } from "../storage/object-storage.port.js";
import { TASK_SEGMENT_ANNOTATION_ROUTING_KEY, SUBMISSION_SOURCE_RETENTION_ROUTING_KEY } from "../messaging/rabbitmq-topology.js";
import { buildTaskSegmentAnnotation, taskSegmentSourceFingerprint, type SegmentAnnotationBuildInput } from "./task-segment-annotation-builder.js";
import { canonicalSegmentJson, segmentJsonSha256, SegmentAnnotationError, taskSegmentAnnotationObjectKey, TASK_SEGMENT_ANNOTATION_SCHEMA_VERSION, validateSegmentAnnotation } from "./task-segment-annotation.js";

export const SEGMENT_ANNOTATION_STALE_MS = 5 * 60 * 1000;

function requireAdmin(actor: PublicUser): void {
  if (actor.role !== "admin") throw new OperationsFailure("FORBIDDEN", "仅管理员可访问片段 JSON", 403);
}

export async function enqueueTaskSegmentAnnotation(manager: EntityManager, asset: TaskSegmentAssetEntity): Promise<void> {
  const repository = manager.getRepository(JobOutboxEntity);
  const event = await repository.findOneBy({ eventType: TASK_SEGMENT_ANNOTATION_ROUTING_KEY, aggregateId: asset.id });
  await repository.save({
    ...(event ?? { id: `JOB-${randomUUID()}`, attempts: 0 }),
    aggregateType: "task_segment_asset", aggregateId: asset.id,
    eventType: TASK_SEGMENT_ANNOTATION_ROUTING_KEY,
    payload: { assetId: asset.id, submissionId: asset.submissionId },
    status: "pending", availableAt: new Date(), publishedAt: null, lastError: null,
  });
}

function revisionMetadata(revision: TaskSegmentAnnotationRevisionEntity, currentId: string | null) {
  return {
    id: revision.id, revision: revision.revision, schemaVersion: revision.schemaVersion,
    publicationStatus: revision.publicationStatus, jsonSha256: revision.jsonSha256,
    jsonSizeBytes: revision.jsonSizeBytes, sourceFingerprint: revision.sourceFingerprint,
    createdAt: revision.createdAt.getTime(), publishedAt: revision.publishedAt?.getTime() ?? null,
    isCurrent: currentId === revision.id,
  };
}

@Injectable()
export class TaskSegmentAnnotationService {
  constructor(private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort) {}

  async process(input: { assetId: string }): Promise<"published" | "failed"> {
    // A session lock prevents concurrent uploads without holding a transaction
    // across object I/O. A crashed worker releases the lock automatically.
    const runner = this.dataSource.createQueryRunner();
    let locked = false;
    let revisionId: string | null = null;
    let directory: string | null = null;
    try {
      await runner.connect();
      const rows = await runner.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [`segment-json:${input.assetId}`]) as Array<{ locked: boolean }>;
      locked = rows[0]?.locked === true;
      if (!locked) throw new SegmentAnnotationError("SEGMENT_JSON_PUBLICATION_BUSY", true);
      try {
        const reserved = await this.dataSource.transaction(async manager => {
          const context = await this.loadInput(manager, input.assetId, true);
          const { asset, run } = context;
          const fingerprint = taskSegmentSourceFingerprint(context);
          const revisions = manager.getRepository(TaskSegmentAnnotationRevisionEntity);
          let revision = await revisions.findOneBy({ taskSegmentAssetId: asset.id, sourceFingerprint: fingerprint });
          if (revision?.publicationStatus === "published") {
            return { revision, context, already: asset.currentAnnotationRevisionId === revision.id && asset.annotationPublicationStatus === "published" };
          }
          if (!revision) {
            const last = await revisions.findOne({ where: { taskSegmentAssetId: asset.id }, order: { revision: "DESC" } });
            const number = (last?.revision ?? 0) + 1;
            const document = buildTaskSegmentAnnotation(context, number);
            const canonicalJson = canonicalSegmentJson(document);
            revision = revisions.create({
              id: `TSAR-${randomUUID()}`, taskSegmentAssetId: asset.id, revision: number,
              schemaVersion: TASK_SEGMENT_ANNOTATION_SCHEMA_VERSION,
              taxonomyVersion: run.labelSetSnapshot?.version ?? null,
              sourceAnnotationRunId: run.id, sourceAnnotationReviewRevision: run.reviewRevision,
              sourceAnnotationPublicationStatus: run.publicationStatus as "auto_accepted" | "human_verified",
              boundaryRefinementPolicyVersion: asset.boundaryRefinementPolicyVersion,
              materializationPolicyVersion: asset.materializationPolicyVersion,
              videoSha256: asset.clipSha256!, sourceFingerprint: fingerprint,
              jsonObjectKey: taskSegmentAnnotationObjectKey(asset.id, number),
              canonicalJson, contentJson: document, jsonSha256: segmentJsonSha256(canonicalJson),
              jsonSizeBytes: String(Buffer.byteLength(canonicalJson, "utf8")),
              publicationStatus: "publishing", attemptCount: 0,
            });
          }
          // Reuse the reserved bytes after upload/finalize failure.
          revision.publicationStatus = "publishing";
          revision.attemptCount += 1;
          revision.failureCode = null;
          revision.failureMessage = null;
          await revisions.save(revision);
          asset.annotationPublicationStatus = "publishing";
          asset.annotationPublicationAttemptCount += 1;
          asset.annotationPublicationFailureCode = null;
          asset.annotationPublicationFailureMessage = null;
          await manager.getRepository(TaskSegmentAssetEntity).save(asset);
          return { revision, context, already: false };
        });
        revisionId = reserved.revision.id;
        if (reserved.already) {
          // Also heals a lost retention outbox wake-up without creating a revision.
          await this.dataSource.transaction(manager => this.enqueueRetentionIfSettled(manager, reserved.context.asset.submissionId));
          return "published";
        }

        const { revision, context } = reserved;
        try {
          const video = await this.storage.headObject({ objectKey: context.asset.clipObjectKey! });
          if (video.sizeBytes !== context.asset.clipSizeBytes) throw new Error("size");
        } catch {
          throw new SegmentAnnotationError("SEGMENT_MEDIA_BINDING_INVALID", true);
        }
        // A canonical key is never overwritten: a complete previous upload is
        // verified and reused; corruption at that key fails closed.
        let exists = false;
        try {
          await this.storage.headObject({ objectKey: revision.jsonObjectKey });
          exists = true;
        } catch (error) {
          if (!this.isMissingObject(error)) throw new SegmentAnnotationError("SEGMENT_JSON_OBJECT_VERIFY_FAILED", true);
        }
        if (!exists) {
          directory = await mkdtemp(join(tmpdir(), "evdp-segment-json-"));
          const file = join(directory, "annotation.json");
          await writeFile(file, revision.canonicalJson, { encoding: "utf8", flag: "wx" });
          try {
            await this.storage.uploadObject({ objectKey: revision.jsonObjectKey, sourcePath: file, contentType: "application/json" });
          } catch {
            throw new SegmentAnnotationError("SEGMENT_JSON_UPLOAD_FAILED", true);
          }
        }
        await this.verifyJsonObject(revision);
        try {
          await this.finalize(input.assetId, revision.id);
        } catch (error) {
          if (error instanceof SegmentAnnotationError) throw error;
          throw new SegmentAnnotationError("SEGMENT_JSON_DATABASE_FINALIZE_FAILED", true);
        }
        return "published";
      } catch (error) {
        const failure = error instanceof SegmentAnnotationError ? error : new SegmentAnnotationError("SEGMENT_JSON_DATABASE_FINALIZE_FAILED", true);
        await this.recordFailure(input.assetId, revisionId, failure);
        if (failure.retryable) throw failure;
        return "failed";
      }
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
      if (locked) await runner.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`segment-json:${input.assetId}`]).catch(() => undefined);
      await runner.release();
    }
  }

  private isMissingObject(error: unknown): boolean {
    const e = error as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
    return e?.$metadata?.httpStatusCode === 404 || ["NotFound", "NoSuchKey"].includes(e?.name ?? "") || e?.code === "ENOENT";
  }

  private async verifyJsonObject(revision: TaskSegmentAnnotationRevisionEntity): Promise<void> {
    try {
      const head = await this.storage.headObject({ objectKey: revision.jsonObjectKey });
      if (head.sizeBytes !== revision.jsonSizeBytes) throw new SegmentAnnotationError("SEGMENT_JSON_OBJECT_VERIFY_FAILED", true);
      const stream = await this.storage.readObject({ objectKey: revision.jsonObjectKey });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > Number(revision.jsonSizeBytes)) {
          (stream as { destroy?: () => void }).destroy?.();
          throw new SegmentAnnotationError("SEGMENT_JSON_HASH_MISMATCH", true);
        }
        chunks.push(bytes);
      }
      if (String(size) !== revision.jsonSizeBytes || segmentJsonSha256(Buffer.concat(chunks)) !== revision.jsonSha256) {
        throw new SegmentAnnotationError("SEGMENT_JSON_HASH_MISMATCH", true);
      }
    } catch (error) {
      if (error instanceof SegmentAnnotationError) throw error;
      throw new SegmentAnnotationError("SEGMENT_JSON_OBJECT_VERIFY_FAILED", true);
    }
  }

  private async finalize(assetId: string, revisionId: string): Promise<void> {
    await this.dataSource.transaction(async manager => {
      const context = await this.loadInput(manager, assetId, true);
      const revisions = manager.getRepository(TaskSegmentAnnotationRevisionEntity);
      const revision = await revisions.findOne({ where: { id: revisionId }, lock: { mode: "pessimistic_write" } });
      const asset = context.asset;
      if (!revision || revision.taskSegmentAssetId !== asset.id || revision.videoSha256 !== asset.clipSha256 ||
          revision.sourceFingerprint !== taskSegmentSourceFingerprint(context)) {
        throw new SegmentAnnotationError("SEGMENT_MEDIA_BINDING_INVALID");
      }
      // The reserved immutable JSON is the only semantic input. Projection and
      // current revision become visible together, or neither change commits.
      const document = validateSegmentAnnotation(revision.contentJson, { assetId: asset.id, revision: revision.revision, videoSha256: revision.videoSha256 });
      await upsertTaskAssetProjection(manager, { assetId: asset.id, revisionId: revision.id, document });
      if (revision.publicationStatus !== "published") {
        if (revision.publicationStatus !== "publishing") throw new SegmentAnnotationError("SEGMENT_JSON_DATABASE_FINALIZE_FAILED", true);
        revision.publicationStatus = "published";
        revision.publishedAt = new Date();
        await revisions.save(revision);
      }
      asset.currentAnnotationRevisionId = revision.id;
      asset.annotationPublicationStatus = "published";
      asset.annotationPublishedAt = revision.publishedAt;
      asset.annotationPublicationFailureCode = null;
      asset.annotationPublicationFailureMessage = null;
      await manager.getRepository(TaskSegmentAssetEntity).save(asset);
      await this.enqueueRetentionIfSettled(manager, asset.submissionId);
    });
  }

  private async loadInput(manager: EntityManager, assetId: string, lock = false): Promise<SegmentAnnotationBuildInput> {
    const assets = manager.getRepository(TaskSegmentAssetEntity);
    const initial = await assets.findOneBy({ id: assetId });
    if (!initial) throw new SegmentAnnotationError("SEGMENT_NOT_READY");
    // Same lock order as source retention: submission -> run -> asset.
    const lockOption = lock ? { mode: "pessimistic_write" as const } : undefined;
    const submission = await manager.getRepository(SubmissionEntity).findOne({ where: { id: initial.submissionId }, lock: lockOption });
    const run = await manager.getRepository(AnnotationRunEntity).findOne({ where: { id: initial.annotationRunId }, lock: lockOption });
    const asset = await assets.findOne({ where: { id: assetId }, lock: lockOption });
    if (!run || !submission || !asset) throw new SegmentAnnotationError("ANNOTATION_RUN_UNAVAILABLE");
    if (asset.annotationRunId !== run.id || asset.submissionId !== submission.id ||
        asset.sourceSha256 !== submission.checksumSha256 || asset.sourceObjectKey !== submission.objectKey) {
      throw new SegmentAnnotationError("SEGMENT_MEDIA_BINDING_INVALID");
    }
    const review = run.reviewRevision > 0 ? await manager.getRepository(AnnotationReviewEntity).findOneBy({
      annotationRunId: run.id, revision: run.reviewRevision,
    }) : null;
    const accepted = acceptedAnnotationRun(run, review);
    if (!accepted) throw new SegmentAnnotationError("ANNOTATION_RUN_NOT_PUBLISHED");
    const metadata = await manager.getRepository(MediaMetadataEntity).findOneBy({ submissionId: submission.id });
    if (!metadata) throw new SegmentAnnotationError("ANNOTATION_RUN_UNAVAILABLE");
    const refinement = asset.boundaryRefinementId ? await manager.getRepository(TaskBoundaryRefinementEntity).findOneBy({ id: asset.boundaryRefinementId }) : null;
    return {
      asset, run, accepted, sourceDurationMs: Number(metadata.durationSeconds) * 1000,
      boundaryRefinementStatus: refinement?.executionStatus ?? null,
      sourceQuality: await manager.getRepository(VideoQualityResultEntity).findOneBy({ submissionId: submission.id }),
    };
  }

  private async recordFailure(assetId: string, revisionId: string | null, error: SegmentAnnotationError): Promise<void> {
    await this.dataSource.transaction(async manager => {
      const asset = await manager.getRepository(TaskSegmentAssetEntity).findOne({ where: { id: assetId }, lock: { mode: "pessimistic_write" } });
      if (!asset) return;
      asset.annotationPublicationStatus = "failed";
      asset.annotationPublicationFailureCode = error.code;
      asset.annotationPublicationFailureMessage = error.code;
      if (!revisionId) asset.annotationPublicationAttemptCount += 1;
      await manager.getRepository(TaskSegmentAssetEntity).save(asset);
      if (revisionId) await manager.getRepository(TaskSegmentAnnotationRevisionEntity).update(
        { id: revisionId, publicationStatus: "publishing" },
        { publicationStatus: "failed", failureCode: error.code, failureMessage: error.code },
      );
    });
  }

  private async enqueueRetentionIfSettled(manager: EntityManager, submissionId: string): Promise<void> {
    const settled = await manager.query(`
      SELECT c.id FROM point_cycles c JOIN point_cycle_items i ON i.cycle_id = c.id
      WHERE i.submission_id = $1 AND c.status = 'settled' LIMIT 1
    `, [submissionId]) as Array<{ id: string }>;
    if (!settled[0]) return;
    const outbox = manager.getRepository(JobOutboxEntity);
    const existing = await outbox.findOneBy({ eventType: SUBMISSION_SOURCE_RETENTION_ROUTING_KEY, aggregateId: submissionId });
    await outbox.save({
      ...(existing ?? { id: `JOB-${randomUUID()}`, attempts: 0 }),
      aggregateType: "submission", aggregateId: submissionId, eventType: SUBMISSION_SOURCE_RETENTION_ROUTING_KEY,
      payload: { submissionId, reason: `settlement:${settled[0].id}:segment-json-published` },
      status: "pending", availableAt: new Date(), publishedAt: null, lastError: null,
    });
  }

  async current(actor: PublicUser, assetId: string) {
    requireAdmin(actor);
    const asset = await this.findAsset(assetId);
    const revision = asset.currentAnnotationRevisionId ? await this.dataSource.getRepository(TaskSegmentAnnotationRevisionEntity).findOneBy({
      id: asset.currentAnnotationRevisionId, taskSegmentAssetId: asset.id, publicationStatus: "published",
    }) : null;
    return {
      assetId, publicationStatus: asset.annotationPublicationStatus,
      failureCode: asset.annotationPublicationFailureCode, failureMessage: asset.annotationPublicationFailureMessage,
      currentRevision: revision ? { ...revisionMetadata(revision, asset.currentAnnotationRevisionId),
        jsonObjectKey: revision.jsonObjectKey, contentJson: revision.contentJson } : null,
    };
  }

  async revisions(actor: PublicUser, assetId: string) {
    requireAdmin(actor);
    const asset = await this.findAsset(assetId);
    const revisions = await this.dataSource.getRepository(TaskSegmentAnnotationRevisionEntity).find({
      where: { taskSegmentAssetId: assetId }, order: { revision: "DESC" },
    });
    return { assetId, revisions: revisions.map(r => revisionMetadata(r, asset.currentAnnotationRevisionId)) };
  }

  async download(actor: PublicUser, assetId: string, revisionNumber: number) {
    requireAdmin(actor);
    if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 1) throw new OperationsFailure("BAD_REQUEST", "Revision 无效", 400);
    const revision = await this.dataSource.getRepository(TaskSegmentAnnotationRevisionEntity).findOneBy({
      taskSegmentAssetId: assetId, revision: revisionNumber, publicationStatus: "published",
    });
    if (!revision) throw new OperationsFailure("NOT_FOUND", "已发布 Revision 不存在", 404);
    try {
      const signed = await this.storage.presignDownloadObject({ objectKey: revision.jsonObjectKey, expiresInSeconds: 15 * 60 });
      return { assetId, revision: revisionNumber, url: signed.url, expiresAt: signed.expiresAt.getTime(), jsonSha256: revision.jsonSha256 };
    } catch {
      throw new OperationsFailure("SEGMENT_JSON_OBJECT_VERIFY_FAILED", "JSON 下载链接暂不可用", 503);
    }
  }

  async retry(actor: PublicUser, assetId: string) {
    requireAdmin(actor);
    return this.dataSource.transaction(async manager => {
      const asset = await manager.getRepository(TaskSegmentAssetEntity).findOne({ where: { id: assetId }, lock: { mode: "pessimistic_write" } });
      if (!asset) throw new OperationsFailure("NOT_FOUND", "任务片段不存在", 404);
      if (asset.generationStatus !== "ready" || asset.validationStatus !== "passed") throw new OperationsFailure("SEGMENT_NOT_READY", "视频尚未通过校验", 409);
      if (asset.annotationPublicationStatus === "published" ||
          (asset.annotationPublicationStatus === "publishing" && Date.now() - asset.updatedAt.getTime() < SEGMENT_ANNOTATION_STALE_MS)) {
        throw new OperationsFailure("SEGMENT_JSON_NOT_RETRYABLE", "已发布或正在发布", 409);
      }
      asset.annotationPublicationStatus = "pending";
      asset.annotationPublicationFailureCode = null;
      asset.annotationPublicationFailureMessage = null;
      await manager.getRepository(TaskSegmentAssetEntity).save(asset);
      await enqueueTaskSegmentAnnotation(manager, asset);
      return { assetId, publicationStatus: "pending" };
    });
  }

  async backfill(input: { dryRun: boolean; limit: number; after?: string }) {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error("limit must be between 1 and 1000");
    const query = this.dataSource.getRepository(TaskSegmentAssetEntity).createQueryBuilder("asset")
      .where("asset.generationStatus = 'ready' AND asset.validationStatus = 'passed'")
      .orderBy("asset.id", "ASC").take(input.limit);
    if (input.after) query.andWhere("asset.id > :after", { after: input.after });
    const assets = await query.getMany();
    const result = { scanned: assets.length, eligible: 0, enqueued: 0, alreadyPublished: 0, blocked: 0, nextCursor: assets.at(-1)?.id ?? null };
    for (const asset of assets) {
      if (asset.currentAnnotationRevisionId) { result.alreadyPublished += 1; continue; }
      try {
        const context = await this.loadInput(this.dataSource.manager, asset.id);
        buildTaskSegmentAnnotation(context, 1);
        const head = await this.storage.headObject({ objectKey: asset.clipObjectKey! });
        if (head.sizeBytes !== asset.clipSizeBytes) throw new SegmentAnnotationError("SEGMENT_MEDIA_BINDING_INVALID");
        result.eligible += 1;
      } catch {
        // Enqueue structurally blocked legacy assets too so the publisher records
        // the exact failure (notably EVIDENCE_OUTSIDE_CLIP) without touching MP4.
        result.blocked += 1;
      }
      if (!input.dryRun) {
        const enqueued = await this.dataSource.transaction(async manager => {
          const current = await manager.getRepository(TaskSegmentAssetEntity).findOne({ where: { id: asset.id }, lock: { mode: "pessimistic_write" } });
          if (!current || current.currentAnnotationRevisionId || current.annotationPublicationStatus === "publishing") return false;
          await enqueueTaskSegmentAnnotation(manager, current);
          return true;
        });
        if (enqueued) result.enqueued += 1;
      }
    }
    return result;
  }

  private async findAsset(id: string): Promise<TaskSegmentAssetEntity> {
    const asset = await this.dataSource.getRepository(TaskSegmentAssetEntity).findOneBy({ id });
    if (!asset) throw new OperationsFailure("NOT_FOUND", "任务片段不存在", 404);
    return asset;
  }
}
