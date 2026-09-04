import type { DataSource, EntityManager } from "typeorm";
import { TaskSegmentAssetEntity } from "../database/entities/task-segment-asset.entity.js";
import { TaskSegmentAnnotationRevisionEntity } from "../database/entities/task-segment-annotation-revision.entity.js";
import { TaskSegmentAssetProjectionEntity } from "../database/entities/task-segment-asset-projection.entity.js";
import { validateSegmentAnnotation, SegmentAnnotationError } from "../task-segment/task-segment-annotation.js";
import { buildTaskAssetProjection, TASK_ASSET_PROJECTION_VERSION } from "./task-asset-projection.js";

export function parseProjectionBackfillArgs(args: string[]) {
  const values = args.filter(v => v !== "--");
  const names = values.map(v => v.split("=")[0]);
  if (new Set(names).size !== names.length || values.some(v => v !== "--dry-run" && !/^--(?:limit|after)=.+$/u.test(v)) ||
      (!values.includes("--dry-run") && !names.includes("--limit"))) throw new Error("Use --dry-run or explicit --limit=1..1000; optional --after=assetId");
  const limitText = values.find(v => v.startsWith("--limit="))?.slice(8) ?? "100";
  const limit = Number(limitText);
  const after = values.find(v => v.startsWith("--after="))?.slice(8);
  if (!/^\d+$/u.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || (after && !/^[\w-]{1,64}$/u.test(after))) throw new Error("Invalid limit or cursor");
  return { dryRun: values.includes("--dry-run"), limit, after };
}

export async function backfillTaskAssetProjections(dataSource: DataSource, input: { dryRun: boolean; limit: number; after?: string }) {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error("Invalid limit");
  const rows = await dataSource.query(`SELECT id FROM task_segment_assets
    WHERE annotation_publication_status = 'published' AND current_annotation_revision_id IS NOT NULL
      AND ($1::text IS NULL OR id > $1) ORDER BY id ASC LIMIT $2`, [input.after ?? null, input.limit]) as Array<{ id: string }>;
  const result = { scanned: rows.length, eligible: 0, created: 0, updated: 0, current: 0, blocked: 0, failed: 0,
    nextCursor: rows.at(-1)?.id ?? null, errors: [] as Array<{ assetId: string; revisionId: string | null; code: string }> };
  for (const row of rows) {
    let revisionId: string | null = null;
    try {
      const inspect = async (manager: EntityManager) => {
        // Asset lock serializes with publisher finalize. No run/submission locks
        // are subsequently acquired, so this cannot invert publisher lock order.
        const asset = await manager.getRepository(TaskSegmentAssetEntity).findOne({ where: { id: row.id },
          ...(input.dryRun ? {} : { lock: { mode: "pessimistic_write" as const } }) });
        revisionId = asset?.currentAnnotationRevisionId ?? null;
        const revision = revisionId ? await manager.getRepository(TaskSegmentAnnotationRevisionEntity).findOneBy({ id: revisionId }) : null;
        if (!asset || asset.annotationPublicationStatus !== "published" || !revision || revision.publicationStatus !== "published" ||
            revision.taskSegmentAssetId !== asset.id || revision.videoSha256 !== asset.clipSha256) return "blocked" as const;
        const repository = manager.getRepository(TaskSegmentAssetProjectionEntity);
        const previous = await repository.findOneBy({ assetId: asset.id });
        if (previous?.currentAnnotationRevisionId === revision.id && previous.projectionVersion === TASK_ASSET_PROJECTION_VERSION) return "current" as const;
        const document = validateSegmentAnnotation(revision.contentJson, { assetId: asset.id, revision: revision.revision, videoSha256: revision.videoSha256 });
        if (document.provenance.source_submission_id !== asset.submissionId || document.provenance.source_annotation_run_id !== asset.annotationRunId) {
          throw new SegmentAnnotationError("TASK_ASSET_PROJECTION_BINDING_INVALID");
        }
        const projection = buildTaskAssetProjection({ assetId: asset.id, revisionId: revision.id, document });
        if (!input.dryRun) await repository.upsert(projection, ["assetId"]);
        return previous ? "updated" as const : "created" as const;
      };
      // Dry run takes no locks and performs strictly SELECTs, even on a read-only DB.
      const outcome = input.dryRun ? await inspect(dataSource.manager) : await dataSource.transaction(inspect);
      if (outcome === "created" || outcome === "updated") result.eligible += 1;
      if (!input.dryRun || outcome === "current" || outcome === "blocked") result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ assetId: row.id, revisionId, code: error instanceof SegmentAnnotationError ? error.code : "TASK_ASSET_PROJECTION_BACKFILL_FAILED" });
    }
  }
  return result;
}
