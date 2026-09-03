import { buildTaskAssetProjection, buildTaskAssetSearchText } from "../src/task-asset/task-asset-projection.js";
import { parseProjectionBackfillArgs } from "../src/task-asset/task-asset-projection-backfill.js";
import { buildTaskSegmentAnnotation } from "../src/task-segment/task-segment-annotation-builder.js";
import { segmentAnnotationFixture } from "./fixtures/task-segment-annotation.js";

const document = () => buildTaskSegmentAnnotation(segmentAnnotationFixture(), 1);
const project = (doc = document()) => buildTaskAssetProjection({ assetId: doc.asset_id, revisionId: "REV-1", document: doc });

describe("deterministic published JSON projection", () => {
  it("uses only JSON, preserves source bytes and distinct unknown states", () => {
    const doc = document();
    const before = JSON.stringify(doc);
    expect(project(doc)).toEqual(project(structuredClone(doc)));
    expect(JSON.stringify(doc)).toBe(before);
    expect(project(doc)).toMatchObject({ sceneGroupKey: "label:SCENE-001", primarySceneName: "家庭厨房",
      taskMappingStatus: "proposed", objectLabelIds: ["OBJ-CUP"], toolLabelIds: [],
      unmappedObjectCount: 0, unmappedToolCount: 1, hasUnmappedLabels: true, effectiveResultStatus: "success" });
    doc.task.result.effective_status = "unknown";
    doc.task.tools = [];
    expect(project(doc)).toMatchObject({ effectiveResultStatus: "unknown", hasUncertainty: true, toolRawTexts: [], unmappedToolCount: 0 });
  });

  it.each([
    ["  ＫＩＴＣＨＥＮ   Counter  ", "室内", "proposed:kitchen counter", "proposed"],
    ["   ", "  室内  ", "proposed:室内", "proposed"],
    [null, null, "unknown", "unknown"],
  ])("groups readable scene %s without invented IDs", (fine, coarse, key, status) => {
    const doc = document(); doc.scene.mapping = null; doc.scene.fine_label = fine; doc.scene.coarse_label = coarse;
    expect(project(doc)).toMatchObject({ sceneGroupKey: key, sceneMappingStatus: status, primarySceneId: null });
  });

  it("deduplicates normalized arrays but preserves ID/name pairs and proposed raw text", () => {
    const doc = document();
    doc.task.manipulated_objects = [doc.task.object_mapping, { raw_text: "  勺子  ", label_id: "Z", label_name: "Ａ", mapping_status: "matched" }];
    doc.task.tools = [{ raw_text: "  Ｓｐｏｎｇｅ ", label_id: null, label_name: null, mapping_status: "proposed" }];
    const p = project(doc);
    expect(p.objectLabelIds).toEqual(["OBJ-CUP", "Z"]);
    expect(p.objectLabelNames).toEqual(["A", "杯子"]);
    expect(p.objectLabels).toContainEqual({ id: "Z", name: "A" });
    expect(p.unmappedObjectCount).toBe(0);
    expect(p).toMatchObject({ toolRawTexts: ["Sponge"], proposedToolCount: 1, unmappedToolCount: 1 });
  });

  it("search covers every requested semantic source, without provenance or prompts", () => {
    const doc = document(); doc.task.description = " ＷＡＳＨ  cup ";
    const search = buildTaskAssetSearchText(doc);
    for (const token of ["wash cup", "wash_or_rinse", "杯子", "家庭厨房", "海绵", "杯子清洁", "grasp", "tool_use"]) expect(search).toContain(token);
    expect(search).not.toContain(doc.asset_id);
    expect(search).not.toMatch(/ {2,}/u);
  });

  it("preserves model/effective and human/inherited distinctions", () => {
    const doc = document(); doc.task.model_completion = "uncertain"; doc.task.effective_completion = "complete";
    doc.task.result.model_status = "unknown"; doc.task.result.effective_status = "partial";
    doc.verification.semantic_verification = "human_verified"; doc.verification.source_annotation_acceptance = "human";
    doc.verification.warnings = ["one", "two"];
    expect(project(doc)).toMatchObject({ modelCompletion: "uncertain", effectiveCompletion: "complete",
      modelResultStatus: "unknown", effectiveResultStatus: "partial", semanticVerification: "human_verified", warningCount: 2 });
  });

  it("rejects invalid schema or asset binding", () => {
    expect(() => buildTaskAssetProjection({ assetId: "wrong", revisionId: "R", document: document() })).toThrow("BINDING_INVALID");
    expect(() => buildTaskAssetProjection({ assetId: "x", revisionId: "R", document: {} })).toThrow("INVALID_DOCUMENT");
  });
});

describe("bounded backfill CLI", () => {
  it("accepts dry run and explicit bounded writes", () => {
    expect(parseProjectionBackfillArgs(["--", "--dry-run"])).toEqual({ dryRun: true, limit: 100, after: undefined });
    expect(parseProjectionBackfillArgs(["--limit=2", "--after=TSA-1"])).toEqual({ dryRun: false, limit: 2, after: "TSA-1" });
  });
  it.each([[], ["--limit=0"], ["--limit=1001"], ["--limit=1.5"], ["--limit=1e2"], ["--limit=2", "--limit=3"], ["--dry-run", "--after="], ["--unknown"]])("rejects unsafe args %j", (...args) => {
    expect(() => parseProjectionBackfillArgs(args as string[])).toThrow();
  });
});
