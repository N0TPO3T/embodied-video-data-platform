import { parseTaskAssetQuery } from "../src/task-asset/dto/task-asset-query.dto.js";
import { buildTaskAssetQuery } from "../src/task-asset/task-asset-query.js";

describe("task asset bounded query", () => {
  it("normalizes, deduplicates, preserves booleans and defaults", () => {
    expect(parseTaskAssetQuery({ q: "  Ｃｕｐ ", sceneKeys: [" label:X, label:Y ", "label:X,,"], hasAudio: "false" })).toMatchObject({
      q: "Cup", sceneKeys: ["label:X", "label:Y"], hasAudio: false, includeHistorical: false, page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc",
    });
  });
  it.each([
    { page: "0" }, { pageSize: "101" }, { page: "1.5" }, { minDurationMs: "-1" }, { minDurationMs: "2", maxDurationMs: "1" },
    { hasAudio: "yes" }, { includeHistorical: "1" }, { resultStatuses: "uncertain" }, { taskVerbs: "invented" },
    { sortBy: "id; DROP TABLE" }, { q: "x".repeat(201) }, { q: ["a", "b"] }, { toolLabelIds: "x".repeat(121) },
    { objectLabelIds: Array.from({ length: 21 }, (_, i) => `L${i}`) }, { secret: "x" },
  ])("rejects invalid parameters %j", input => { expect(() => parseTaskAssetQuery(input)).toThrow(); });
  it("uses parameterized OR within dimensions and AND across dimensions", () => {
    const sql = buildTaskAssetQuery(parseTaskAssetQuery({ q: "%'_\\", sceneKeys: "label:1,label:2", objectLabelIds: "A,B", hasAudio: "false" }));
    expect(sql.from).toContain("p.scene_group_key = ANY($2::text[])");
    expect(sql.from).toContain("p.object_label_ids && $3::text[]");
    expect(sql.params).toContainEqual(["A", "B"]);
    expect(sql.from).not.toContain("%'_");
    expect(sql.order).toBe("a.created_at DESC, a.id DESC");
  });
});
