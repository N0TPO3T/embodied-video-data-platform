import { vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { DataSource } from "typeorm";
import request from "supertest";
import { createDataSource } from "../src/database/data-source.js";
import { TaskAssetService } from "../src/task-asset/task-asset.service.js";
import { TaskAssetController } from "../src/task-asset/task-asset.controller.js";
import { AuthService } from "../src/auth/auth.service.js";
import { SessionGuard } from "../src/auth/session.guard.js";
import { OperationsFailureFilter } from "../src/operations/operations-failure.filter.js";
import { configureApplication } from "../src/http/configure-application.js";
import { TaskSegmentAssetProjectionEntity } from "../src/database/entities/task-segment-asset-projection.entity.js";
import { TaskSegmentAssetEntity } from "../src/database/entities/task-segment-asset.entity.js";
import { TaskSegmentAnnotationRevisionEntity } from "../src/database/entities/task-segment-annotation-revision.entity.js";
import { canonicalSegmentJson, segmentJsonSha256 } from "../src/task-segment/task-segment-annotation.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { TaskAssetProjection2026091300001 } from "../src/database/migrations/202609130001-task-asset-projection.js";
import { backfillTaskAssetProjections } from "../src/task-asset/task-asset-projection-backfill.js";
import { seedPublishedTaskAsset, seedTaskAssetOwner, taskAssetAdmin as admin } from "./fixtures/task-asset.js";

describe("task asset search, scene inventory and DB-only backfill", () => {
  let ds: DataSource;
  let service: TaskAssetService;
  let app: INestApplication;
  const authenticate = vi.fn();
  beforeAll(async () => {
    ds = createDataSource(process.env.TEST_DATABASE_URL); await ds.initialize();
    console.log("task asset disposable database:", (await ds.query("SELECT current_database() AS name"))[0].name);
    await ds.dropDatabase(); await ds.runMigrations(); await seedTaskAssetOwner(ds);
    service = new TaskAssetService(ds);
    const module = await Test.createTestingModule({ controllers: [TaskAssetController], providers: [
      { provide: TaskAssetService, useValue: service }, { provide: AuthService, useValue: { authenticate } }, SessionGuard, OperationsFailureFilter,
    ] }).compile();
    app = module.createNestApplication(); configureApplication(app); await app.init();
  });
  afterAll(async () => { await app?.close(); if (ds?.isInitialized) await ds.destroy(); });
  beforeEach(async () => {
    await ds.query("TRUNCATE task_segment_asset_projections, task_segment_annotation_revisions, task_segment_assets, annotation_runs, submissions CASCADE");
    authenticate.mockResolvedValue(admin);
  });

  async function examples() {
    const a = await seedPublishedTaskAsset(ds, "A", doc => {
      doc.task.mapping = { status: "matched", label_id: "TASK-WASH", label_name: "清洗", source_text: "清洗" };
      doc.task.tools = [{ raw_text: "海绵", label_id: "TOOL-SPONGE", label_name: "海绵", mapping_status: "matched" }];
    });
    const b = await seedPublishedTaskAsset(ds, "B", doc => {
      doc.scene.mapping = null; doc.scene.fine_label = " 阳台 "; doc.task.verb = "open";
      doc.task.tools = []; doc.task.object_mapping = { raw_text: "未知容器", label_id: null, label_name: null, mapping_status: "unmapped" };
      doc.task.manipulated_objects = []; doc.task.result.effective_status = "unknown"; doc.task.effective_completion = "uncertain";
    });
    const c = await seedPublishedTaskAsset(ds, "C", doc => {
      doc.verification.semantic_verification = "human_verified"; doc.verification.source_annotation_acceptance = "human";
      doc.task.result.effective_status = "failure"; doc.task.effective_completion = "incomplete";
    });
    return { a, b, c };
  }

  it("searches only current formal assets and returns a privacy-safe paginated read model", async () => {
    await examples();
    const result = await service.list(admin, {});
    expect(result.summary).toMatchObject({ assetCount: 3, sourceGroupCount: 3, totalSegmentDurationMs: 33000, humanVerifiedCount: 1, uncertainAssetCount: 1 });
    expect(result.indexHealth).toMatchObject({ totalPublishedAssets: 3, projectedCurrentAssets: 3, missingProjectionAssets: 0 });
    expect(result.items.find(v => v.assetId === "TSA-JSON-B")).toMatchObject({ scene: { groupKey: "proposed:阳台", id: null }, tools: { rawTexts: [] }, resultStatus: "unknown" });
    for (const forbidden of ["objectKey", "uploads/", "canonicalJson", "contentJson", "Private Owner", "prompt", "presign"]) expect(JSON.stringify(result)).not.toContain(forbidden);
  });

  it("combines OR dimensions with AND and literal Unicode keyword matching", async () => {
    await examples();
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ sceneKeys: "label:SCENE-001" }, 2], [{ taskVerbs: "open,wash_or_rinse" }, 3], [{ objectLabelIds: "NO,OBJ-CUP", toolLabelIds: "TOOL-SPONGE" }, 1],
      [{ sceneKeys: "proposed:阳台", objectLabelIds: "OBJ-CUP" }, 0], [{ handModes: "both", executionPatterns: "single_goal", interactionPrimitives: "grasp", complexitySignals: "tool_use" }, 3],
      [{ completions: "incomplete", resultStatuses: "failure" }, 1], [{ semanticVerifications: "human_verified", sourceAnnotationAcceptances: "human" }, 1],
      [{ boundarySources: "coarse", materializationModes: "exact_clip_transcode", hasAudio: "true", minDurationMs: "11000", maxDurationMs: "11000" }, 3],
      [{ hasUnmappedLabels: "false" }, 1], [{ hasUncertainty: "true" }, 1], [{ sourceGroupId: "SUB-JSON-B" }, 1],
      [{ q: "  杯子清洁 " }, 3], [{ q: "%" }, 0], [{ q: "_" }, 3], [{ q: "' OR 1=1 --" }, 0],
      [{ failureRecoveryStatuses: "none_observed", taskLabelIds: "TASK-WASH" }, 1], [{ sceneMappingStatuses: "proposed" }, 1],
    ];
    for (const [query, count] of cases) expect((await service.list(admin, query)).summary.assetCount, JSON.stringify(query)).toBe(count);
  });

  it("uses stable ID tie breaks and has consistent empty/out-of-range pages", async () => {
    await examples(); await ds.query("UPDATE task_segment_assets SET created_at = '2026-09-03T00:00:00Z'");
    const pages = await Promise.all([1, 2, 3].map(page => service.list(admin, { page: String(page), pageSize: "1" })));
    expect(pages.map(p => p.items[0]?.assetId)).toEqual(["TSA-JSON-C", "TSA-JSON-B", "TSA-JSON-A"]);
    expect((await service.list(admin, { page: "9" })).items).toEqual([]);
    expect((await service.list(admin, { q: "absent" })).pagination).toMatchObject({ total: 0, totalPages: 0 });
  });

  it("facets and scenes match the same filtered scope, including top raw labels", async () => {
    await examples();
    const facets = await service.facets(admin, { sceneKeys: "label:SCENE-001" });
    expect(facets.scenes).toEqual([{ key: "label:SCENE-001", id: "SCENE-001", name: "家庭厨房", status: "matched", count: 2 }]);
    expect(facets.objects).toEqual([{ id: "OBJ-CUP", name: "杯子", count: 2 }]);
    expect(facets.tools).toEqual([{ id: "TOOL-SPONGE", name: "海绵", count: 1 }]);
    expect(facets.results).toHaveLength(2);
    const scenes = await service.sceneSummary(admin, {});
    expect(scenes.totals).toMatchObject({ assetCount: 3, totalSegmentDurationMs: 33000, sourceGroupCount: 3 });
    expect(scenes.rows.find(r => r.sceneKey === "proposed:阳台")).toMatchObject({ unknownResultCount: 1, uncertainCompletionCount: 1, topObjects: [{ id: null, name: "未知容器", count: 1 }], topTools: [] });
    expect((await service.sceneSummary(admin, { taskVerbs: "open" })).rows).toHaveLength(1);
    expect(Object.values(await service.facets(admin, { q: "absent" })).every(v => v.length === 0)).toBe(true);
  });

  it("sums overlapping clips but counts a shared original upload once across scenes", async () => {
    const { fixture } = await seedPublishedTaskAsset(ds, "OVERLAP1");
    await seedPublishedTaskAsset(ds, "OVERLAP2", doc => { doc.scene.mapping = null; doc.scene.fine_label = "另一场景"; },
      { submissionId: fixture.asset.submissionId, runId: fixture.run.id, taskIndex: 1 });
    const summary = await service.sceneSummary(admin, {});
    expect(summary.rows).toHaveLength(2);
    expect(summary.rows.map(r => r.sourceGroupCount)).toEqual([1, 1]);
    expect(summary.totals).toMatchObject({ sourceGroupCount: 1, assetCount: 2, totalSegmentDurationMs: 22000 });
  });

  it.each(["superseded", "candidate_only", "rejected"])("excludes publication %s by default; historical includes only superseded", async status => {
    const { a } = await examples();
    await ds.getRepository(AnnotationRunEntity).update(a.fixture.run.id, { publicationStatus: status as "superseded" });
    expect((await service.list(admin, {})).summary.assetCount).toBe(2);
    const history = await service.list(admin, { includeHistorical: "true" });
    expect(history.summary.assetCount).toBe(status === "superseded" ? 3 : 2);
    if (status === "superseded") expect(history.items.find(v => v.assetId === a.fixture.asset.id)?.isCurrent).toBe(false);
    expect((await service.facets(admin, {})).taskLabels).toEqual([]);
    expect((await service.sceneSummary(admin, {})).totals.assetCount).toBe(2);
    expect(await service.exportCsv(admin, {})).not.toContain(a.fixture.asset.id);
  });

  it.each(["generation", "validation", "annotation", "execution"])("excludes unready %s assets from every endpoint", async kind => {
    const { fixture } = await seedPublishedTaskAsset(ds, "GATE");
    if (kind === "generation") await ds.getRepository(TaskSegmentAssetEntity).update(fixture.asset.id, { generationStatus: "failed" });
    if (kind === "validation") await ds.getRepository(TaskSegmentAssetEntity).update(fixture.asset.id, { validationStatus: "failed" });
    if (kind === "annotation") await ds.getRepository(TaskSegmentAssetEntity).update(fixture.asset.id, { annotationPublicationStatus: "pending" });
    if (kind === "execution") await ds.getRepository(AnnotationRunEntity).update(fixture.run.id, { executionStatus: "system_failed" });
    expect((await service.list(admin, {})).summary.assetCount).toBe(0);
    expect((await service.sceneSummary(admin, {})).totals.assetCount).toBe(0);
    expect((await service.facets(admin, {})).scenes).toEqual([]);
    expect(await service.exportCsv(admin, {})).not.toContain(fixture.asset.id);
  });

  it("backfills missing/stale indexes from JSON, including source-deleted assets; dry run writes nothing", async () => {
    const { a, b, c } = await examples();
    const repo = ds.getRepository(TaskSegmentAssetProjectionEntity);
    await repo.delete(a.fixture.asset.id); await repo.update(b.fixture.asset.id, { projectionVersion: "old" });
    await ds.query("UPDATE submissions SET storage_status = 'deleted'");
    expect((await service.list(admin, {})).indexHealth).toMatchObject({ totalPublishedAssets: 3, projectedCurrentAssets: 1, missingProjectionAssets: 1, staleProjectionAssets: 1 });
    const before = await repo.find();
    expect(await backfillTaskAssetProjections(ds, { dryRun: true, limit: 100 })).toMatchObject({ scanned: 3, eligible: 2, created: 0, updated: 0, current: 1 });
    expect(await repo.find()).toEqual(before);
    const first = await backfillTaskAssetProjections(ds, { dryRun: false, limit: 1 });
    expect(first).toMatchObject({ scanned: 1, created: 1, nextCursor: a.fixture.asset.id });
    expect(await backfillTaskAssetProjections(ds, { dryRun: false, limit: 100, after: first.nextCursor! })).toMatchObject({ scanned: 2, updated: 1, current: 1 });
    expect((await service.list(admin, {})).summary.assetCount).toBe(3);
    expect((await service.facets(admin, {})).scenes).toHaveLength(2);
    expect(await service.exportCsv(admin, {})).toContain(c.fixture.asset.id);
    expect(await backfillTaskAssetProjections(ds, { dryRun: false, limit: 100 })).toMatchObject({ current: 3, created: 0, updated: 0 });
  });

  it("CSV ignores pagination, preserves Chinese/quotes and neutralizes formulas without private fields", async () => {
    await seedPublishedTaskAsset(ds, "CSV", doc => { doc.task.description = '=HYPERLINK("evil"),中文\n下一行'; });
    const csv = await service.exportCsv(admin, { page: "99", pageSize: "1" });
    expect(csv).toContain('"\'=HYPERLINK(""evil""),中文\n下一行"');
    expect(csv).toContain("grasp|rub_or_wipe"); expect(csv).toContain("source_group_id");
    for (const value of ["Private Owner", "Private Team", "uploads/", "video.mp4", "content_json", "prompt", "password"]) expect(csv).not.toContain(value);
  });

  it("replaces a stale revision projection using only the current JSON, never mutable Run semantics", async () => {
    const { fixture, doc, revision } = await seedPublishedTaskAsset(ds, "REVISION");
    doc.annotation_revision = 2; doc.task.description = "新版语义"; doc.task.verb = "open";
    const canonical = canonicalSegmentJson(doc);
    const next = await ds.getRepository(TaskSegmentAnnotationRevisionEntity).save({ ...revision, id: "REV-2", revision: 2,
      jsonObjectKey: `segments/${fixture.asset.id}/annotation.r0002.json`, contentJson: doc, canonicalJson: canonical,
      sourceFingerprint: segmentJsonSha256(canonical), jsonSha256: segmentJsonSha256(canonical), jsonSizeBytes: String(Buffer.byteLength(canonical)) });
    await ds.getRepository(TaskSegmentAssetEntity).update(fixture.asset.id, { currentAnnotationRevisionId: next.id });
    await ds.getRepository(AnnotationRunEntity).update(fixture.run.id, { normalizedResult: null });
    expect((await service.list(admin, {})).indexHealth).toMatchObject({ staleProjectionAssets: 1, projectedCurrentAssets: 0 });
    expect(await backfillTaskAssetProjections(ds, { dryRun: false, limit: 100 })).toMatchObject({ updated: 1 });
    expect((await service.list(admin, {})).items[0]).toMatchObject({ currentAnnotationRevisionId: "REV-2", task: { description: "新版语义", verb: "open" } });
    expect((await ds.getRepository(TaskSegmentAnnotationRevisionEntity).findOneByOrFail({ id: revision.id })).canonicalJson).toBe(revision.canonicalJson);
  });

  it("continues after one invalid current JSON and emits only a fixed failure code", async () => {
    const { a } = await examples();
    await ds.getRepository(TaskSegmentAssetProjectionEntity).clear();
    const next = await ds.getRepository(TaskSegmentAnnotationRevisionEntity).save({ ...a.revision, id: "REV-BAD", revision: 2,
      jsonObjectKey: "segments/test/annotation.r0002.json", contentJson: { secret: "private-key-never-log" }, canonicalJson: "{}",
      sourceFingerprint: "f".repeat(64), jsonSha256: segmentJsonSha256("{}"), jsonSizeBytes: "2" });
    await ds.getRepository(TaskSegmentAssetEntity).update(a.fixture.asset.id, { currentAnnotationRevisionId: next.id });
    const result = await backfillTaskAssetProjections(ds, { dryRun: false, limit: 100 });
    expect(result).toMatchObject({ scanned: 3, created: 2, failed: 1 });
    expect(result.errors[0]?.assetId).toBe(a.fixture.asset.id);
    expect(JSON.stringify(result)).not.toContain("private-key");
    expect(JSON.stringify(result)).not.toContain("segments/");
  });

  it("rechecks the current revision after acquiring the asset lock during concurrent publication", async () => {
    const { fixture, doc, revision } = await seedPublishedTaskAsset(ds, "LOCK");
    await ds.getRepository(TaskSegmentAssetProjectionEntity).delete(fixture.asset.id);
    doc.annotation_revision = 2; doc.task.description = "并发新版";
    const canonical = canonicalSegmentJson(doc);
    await ds.getRepository(TaskSegmentAnnotationRevisionEntity).save({ ...revision, id: "REV-CONCURRENT", revision: 2,
      jsonObjectKey: "segments/lock/annotation.r0002.json", contentJson: doc, canonicalJson: canonical,
      sourceFingerprint: segmentJsonSha256(canonical), jsonSha256: segmentJsonSha256(canonical), jsonSizeBytes: String(Buffer.byteLength(canonical)) });
    const runner = ds.createQueryRunner(); await runner.connect(); await runner.startTransaction();
    const originalQuery = ds.query.bind(ds);
    let scanned!: () => void;
    const scanComplete = new Promise<void>(resolve => { scanned = resolve; });
    const spy = vi.spyOn(ds, "query").mockImplementationOnce(async (...args) => { const rows = await originalQuery(...args); scanned(); return rows; });
    try {
      await runner.query("UPDATE task_segment_assets SET current_annotation_revision_id = 'REV-CONCURRENT' WHERE id = $1", [fixture.asset.id]);
      const job = backfillTaskAssetProjections(ds, { dryRun: false, limit: 100 });
      await scanComplete; await runner.commitTransaction();
      expect(await job).toMatchObject({ created: 1, failed: 0 });
      expect(await ds.getRepository(TaskSegmentAssetProjectionEntity).findOneByOrFail({ assetId: fixture.asset.id })).toMatchObject({ currentAnnotationRevisionId: "REV-CONCURRENT", taskDescription: "并发新版" });
    } finally { spy.mockRestore(); if (runner.isTransactionActive) await runner.rollbackTransaction(); await runner.release(); }
  });

  it("bounds CSV at 50,000 rows before serialization", async () => {
    const spy = vi.spyOn(ds, "query").mockResolvedValueOnce(new Array(50_001));
    try {
      await expect(service.exportCsv(admin, {})).rejects.toMatchObject({ code: "TASK_ASSET_EXPORT_LIMIT_EXCEEDED" });
      expect(spy.mock.calls[0]?.[0]).toContain("LIMIT 50001");
    } finally { spy.mockRestore(); }
  });

  it.each(["", "/facets", "/scene-summary", "/export.csv"])("HTTP permissions and validation on %s", async path => {
    authenticate.mockResolvedValue(null); await request(app.getHttpServer()).get(`/api/v1/operations/task-assets${path}`).expect(401);
    for (const role of ["leader", "collector"]) {
      authenticate.mockResolvedValue({ ...admin, role }); await request(app.getHttpServer()).get(`/api/v1/operations/task-assets${path}`).expect(403);
    }
    authenticate.mockResolvedValue(admin); await request(app.getHttpServer()).get(`/api/v1/operations/task-assets${path}`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/operations/task-assets${path}?pageSize=101`).expect(400);
  });

  it("projection migration up/down/up leaves canonical assets and revisions untouched", async () => {
    const { fixture, revision } = await seedPublishedTaskAsset(ds, "MIGRATION");
    const runner = ds.createQueryRunner(); await runner.connect();
    try {
      const migration = new TaskAssetProjection2026091300001();
      await migration.down(runner); await migration.up(runner);
      expect(await ds.getRepository(TaskSegmentAssetProjectionEntity).count()).toBe(0);
      expect((await ds.getRepository(TaskSegmentAssetEntity).findOneByOrFail({ id: fixture.asset.id })).currentAnnotationRevisionId).toBe(revision.id);
      expect(await backfillTaskAssetProjections(ds, { dryRun: false, limit: 100 })).toMatchObject({ created: 1 });
    } finally { await runner.release(); }
  });
});
