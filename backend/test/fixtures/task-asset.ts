import type { DataSource } from "typeorm";
import type { TaskSegmentAnnotationV1 } from "../../src/task-segment/task-segment-annotation.js";
import { canonicalSegmentJson, segmentJsonSha256 } from "../../src/task-segment/task-segment-annotation.js";
import { buildTaskSegmentAnnotation } from "../../src/task-segment/task-segment-annotation-builder.js";
import { TaskSegmentAnnotationRevisionEntity } from "../../src/database/entities/task-segment-annotation-revision.entity.js";
import { TaskSegmentAssetEntity } from "../../src/database/entities/task-segment-asset.entity.js";
import { AnnotationRunEntity } from "../../src/database/entities/annotation-run.entity.js";
import { SubmissionEntity } from "../../src/database/entities/submission.entity.js";
import { TeamEntity } from "../../src/database/entities/team.entity.js";
import { UserEntity } from "../../src/database/entities/user.entity.js";
import { upsertTaskAssetProjection } from "../../src/task-asset/task-asset-projection.js";
import { segmentAnnotationFixture } from "./task-segment-annotation.js";
import type { PublicUser } from "../../src/auth/auth.types.js";

export const taskAssetAdmin: PublicUser = { id: "ASSET-ADMIN", username: "asset-admin", displayName: "Private Owner", role: "admin", status: "active", updatedAt: 0 };

export async function seedTaskAssetOwner(ds: DataSource) {
  await ds.getRepository(TeamEntity).save({ id: "ASSET-TEAM", name: "Private Team" });
  await ds.getRepository(UserEntity).save({ ...taskAssetAdmin, usernameNormalized: "asset-admin", passwordHash: "unused", updatedAt: new Date() });
}

export async function seedPublishedTaskAsset(ds: DataSource, suffix: string,
  configure?: (document: TaskSegmentAnnotationV1) => void,
  shared?: { submissionId: string; runId: string; taskIndex: number }) {
  const fixture = segmentAnnotationFixture(suffix);
  const doc = buildTaskSegmentAnnotation(fixture, 1);
  if (shared) {
    fixture.asset.submissionId = shared.submissionId; fixture.asset.annotationRunId = shared.runId; fixture.asset.taskIndex = shared.taskIndex;
    fixture.asset.sourceObjectKey = `uploads/${shared.submissionId}.mp4`;
    doc.provenance.source_submission_id = shared.submissionId; doc.provenance.source_group_id = shared.submissionId;
    doc.provenance.source_annotation_run_id = shared.runId; doc.provenance.task_index = shared.taskIndex;
  } else {
    await ds.getRepository(SubmissionEntity).save({ id: fixture.asset.submissionId, ownerId: taskAssetAdmin.id, teamId: "ASSET-TEAM",
      originalFileName: "private-source.mp4", contentType: "video/mp4", expectedSizeBytes: "6", checksumSha256: fixture.asset.sourceSha256,
      objectKey: fixture.asset.sourceObjectKey, uploadStatus: "uploaded", processingStatus: "completed", storageStatus: "available" });
    await ds.getRepository(AnnotationRunEntity).save(fixture.run);
  }
  configure?.(doc);
  const canonical = canonicalSegmentJson(doc);
  const revision = Object.assign(new TaskSegmentAnnotationRevisionEntity(), {
    id: `TSAR-LIB-${suffix}`, taskSegmentAssetId: fixture.asset.id, revision: 1, schemaVersion: "task_segment.v1",
    sourceAnnotationRunId: fixture.asset.annotationRunId, sourceAnnotationReviewRevision: 0,
    sourceAnnotationPublicationStatus: "auto_accepted", materializationPolicyVersion: fixture.asset.materializationPolicyVersion,
    videoSha256: fixture.asset.clipSha256, sourceFingerprint: segmentJsonSha256(canonical),
    jsonObjectKey: `segments/${fixture.asset.id}/annotation.r0001.json`, jsonSha256: segmentJsonSha256(canonical), jsonSizeBytes: String(Buffer.byteLength(canonical)),
    canonicalJson: canonical, contentJson: doc, publicationStatus: "published", attemptCount: 1, publishedAt: new Date("2026-09-03T00:00:00Z"),
  });
  await ds.transaction(async manager => {
    await manager.getRepository(TaskSegmentAssetEntity).save(fixture.asset);
    await manager.getRepository(TaskSegmentAnnotationRevisionEntity).save(revision);
    await upsertTaskAssetProjection(manager, { assetId: fixture.asset.id, revisionId: revision.id, document: doc });
    await manager.getRepository(TaskSegmentAssetEntity).update(fixture.asset.id, {
      annotationPublicationStatus: "published", currentAnnotationRevisionId: revision.id, annotationPublishedAt: revision.publishedAt,
    });
  });
  return { fixture, doc, revision };
}
