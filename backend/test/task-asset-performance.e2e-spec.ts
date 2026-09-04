import type { DataSource } from "typeorm";
import { createDataSource } from "../src/database/data-source.js";
import { parseTaskAssetQuery } from "../src/task-asset/dto/task-asset-query.dto.js";
import { buildTaskAssetQuery } from "../src/task-asset/task-asset-query.js";
import { TASK_ASSET_SELECT } from "../src/task-asset/task-asset-read-model.js";
import { TASK_ASSET_FACET_SELECT, TASK_ASSET_SCENE_SELECT, TaskAssetService } from "../src/task-asset/task-asset.service.js";
import { seedPublishedTaskAsset, seedTaskAssetOwner, taskAssetAdmin } from "./fixtures/task-asset.js";

// Opt-in scale fixture. Synthetic rows test query/index behavior, not annotation
// accuracy, model throughput or production latency. No object storage required.
const performanceSuite = process.env.TASK_ASSET_PERF === "true" ? describe : describe.skip;
performanceSuite("task asset 10,000-row SQL performance smoke", () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = createDataSource(process.env.TEST_DATABASE_URL); await ds.initialize();
    console.log("performance database:", (await ds.query("SELECT current_database() AS name"))[0].name);
    await ds.dropDatabase(); await ds.runMigrations(); await seedTaskAssetOwner(ds);
    await seedPublishedTaskAsset(ds, "PERF");
    // Evaluate each composite conversion once per row, not once per expanded column.
    await ds.query(`INSERT INTO task_segment_assets SELECT fixture.* FROM task_segment_assets a CROSS JOIN generate_series(1, 9999) n
      CROSS JOIN LATERAL jsonb_populate_record(NULL::task_segment_assets,
      to_jsonb(a) || jsonb_build_object('id', 'PERF-' || lpad(n::text, 5, '0'), 'task_index', n,
        'clip_object_key', 'segments/PERF-' || n || '/video.mp4', 'current_annotation_revision_id', NULL,
        'annotation_publication_status', 'pending')) fixture WHERE a.id = 'TSA-JSON-PERF'`);
    await ds.query(`INSERT INTO task_segment_annotation_revisions SELECT fixture.* FROM task_segment_annotation_revisions r CROSS JOIN generate_series(1, 9999) n
      CROSS JOIN LATERAL jsonb_populate_record(NULL::task_segment_annotation_revisions,
      to_jsonb(r) || jsonb_build_object('id', 'PERF-REV-' || lpad(n::text, 5, '0'), 'task_segment_asset_id', 'PERF-' || lpad(n::text, 5, '0'),
        'json_object_key', 'segments/PERF-' || n || '/annotation.r0001.json')) fixture WHERE r.id = 'TSAR-LIB-PERF'`);
    await ds.query(`UPDATE task_segment_assets SET current_annotation_revision_id = 'PERF-REV-' || substring(id from 6),
      annotation_publication_status = 'published' WHERE id LIKE 'PERF-%'`);
    await ds.query(`INSERT INTO task_segment_asset_projections SELECT fixture.* FROM task_segment_asset_projections p CROSS JOIN generate_series(1, 9999) n
      CROSS JOIN LATERAL jsonb_populate_record(NULL::task_segment_asset_projections,
      to_jsonb(p) || jsonb_build_object('asset_id', 'PERF-' || lpad(n::text, 5, '0'), 'current_annotation_revision_id', 'PERF-REV-' || lpad(n::text, 5, '0'),
        'scene_group_key', CASE WHEN n % 100 = 0 THEN 'label:SCENE-RARE' ELSE 'label:SCENE-001' END,
        'primary_scene_id', CASE WHEN n % 100 = 0 THEN 'SCENE-RARE' ELSE 'SCENE-001' END,
        'primary_scene_name', CASE WHEN n % 100 = 0 THEN '稀有场景' ELSE '家庭厨房' END,
        'object_label_ids', jsonb_build_array(CASE WHEN n % 100 = 0 THEN 'OBJ-RARE' ELSE 'OBJ-CUP' END),
        'object_labels', jsonb_build_array(jsonb_build_object('id', CASE WHEN n % 100 = 0 THEN 'OBJ-RARE' ELSE 'OBJ-CUP' END, 'name', '杯子')),
        'tool_label_ids', jsonb_build_array(CASE WHEN n % 137 = 0 THEN 'TOOL-RARE' ELSE 'TOOL-COMMON' END),
        'tool_labels', jsonb_build_array(jsonb_build_object('id', CASE WHEN n % 137 = 0 THEN 'TOOL-RARE' ELSE 'TOOL-COMMON' END, 'name', '工具'))
      )) fixture WHERE p.asset_id = 'TSA-JSON-PERF'`);
    // Flush GIN pending lists before measuring indexed lookup.
    await ds.query("VACUUM ANALYZE task_segment_asset_projections");
    for (const table of ["task_segment_assets", "task_segment_annotation_revisions", "annotation_runs"]) await ds.query(`ANALYZE ${table}`);
  }, 120000);
  afterAll(async () => { if (ds?.isInitialized) await ds.destroy(); });

  it("has exactly 10,000 rows and reports actual EXPLAIN ANALYZE plans without forcing indexes", async () => {
    const service = new TaskAssetService(ds);
    expect((await service.list(taskAssetAdmin, {})).summary.assetCount).toBe(10000);
    const cases = [
      { name: "first-page", input: {}, index: null },
      { name: "scene-filter", input: { sceneKeys: "label:SCENE-RARE" }, index: "idx_tap_scene_group_key" },
      { name: "object-filter", input: { objectLabelIds: "OBJ-RARE" }, index: "idx_tap_object_label_ids" },
      { name: "tool-filter", input: { toolLabelIds: "TOOL-RARE" }, index: "idx_tap_tool_label_ids" },
      { name: "scene-summary", input: {}, index: null },
      { name: "facets", input: {}, index: null },
    ];
    for (const item of cases) {
      const sql = buildTaskAssetQuery(parseTaskAssetQuery(item.input));
      const statement = item.name === "scene-summary" ? `WITH filtered AS MATERIALIZED (SELECT ${TASK_ASSET_SELECT} ${sql.from}) ${TASK_ASSET_SCENE_SELECT}`
        : item.name === "facets" ? `WITH filtered AS MATERIALIZED (SELECT ${TASK_ASSET_SELECT} ${sql.from}) ${TASK_ASSET_FACET_SELECT}`
        : `SELECT ${TASK_ASSET_SELECT} ${sql.from} ORDER BY ${sql.order} LIMIT 50`;
      const result = await ds.transaction(async manager => {
        await manager.query("SET TRANSACTION READ ONLY");
        // Match the two aggregate APIs' transaction-local setting; never force indexes.
        if (item.name === "scene-summary" || item.name === "facets") await manager.query("SET LOCAL jit = off");
        return manager.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`, sql.params) as Promise<Array<{ "QUERY PLAN": unknown }>>;
      });
      const plan = JSON.stringify(result[0]!["QUERY PLAN"]);
      if (item.index) expect(plan).toContain(item.index);
      console.log("TASK_ASSET_EXPLAIN", JSON.stringify({ case: item.name, plan: result[0]!["QUERY PLAN"] }));
    }
  }, 120000);
});
