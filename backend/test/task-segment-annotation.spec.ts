import { segmentAnnotationFixture } from "./fixtures/task-segment-annotation.js";
import { buildTaskSegmentAnnotation, collectTaskSegmentEvidence, sourceToClipTimestamp, taskSegmentSourceFingerprint } from "../src/task-segment/task-segment-annotation-builder.js";
import { canonicalSegmentJson, segmentJsonSha256, taskSegmentAnnotationSchema, validateSegmentAnnotation } from "../src/task-segment/task-segment-annotation.js";
import { taskSegmentTargetBounds } from "../src/task-segment/task-segment.service.js";

describe("task_segment.v1 contract", () => {
  it("builds a self-contained strict document and reuses published label mappings", () => {
    const input = segmentAnnotationFixture();
    const doc = buildTaskSegmentAnnotation(input, 1);
    expect(doc.schema_version).toBe("task_segment.v1");
    expect(doc.scene.verification).toBe("inherited_from_published_annotation");
    expect(doc.scene.mapping?.label_id).toBe("SCENE-001");
    expect(doc.task.mapping?.status).toBe("proposed");
    expect(doc.task.tools[0]).toEqual({ raw_text: "海绵", label_id: null, label_name: null, mapping_status: "unmapped" });
    expect(doc.task.atomic_actions.map(a => a.order)).toEqual([1, 2]);
    expect(doc.provenance.source_group_id).toBe(input.asset.submissionId);
    expect(doc.timeline.task_interval_ms).toEqual([500, 10500]);
    expect(doc.task.evidence_timestamps_ms).toEqual([2500, 8500]);
    expect(doc.source_video_quality).toBeNull();
  });

  it.each([
    ["extra field", (d: any) => { d.private_field = "no"; }],
    ["nested extra", (d: any) => { d.media.objectKey = "no"; }],
    ["bad SHA", (d: any) => { d.media.sha256 = "etag"; }],
    ["invalid enum", (d: any) => { d.task.verb = "invented"; }],
    ["NaN", (d: any) => { d.task.evidence_timestamps_ms = [NaN]; }],
    ["negative time", (d: any) => { d.task.evidence_timestamps_ms = [-1]; }],
    ["beyond clip", (d: any) => { d.task.evidence_timestamps_ms = [11001]; }],
    ["bad duration", (d: any) => { d.timeline.clip_duration_ms = 123; }],
    ["bad group", (d: any) => { d.provenance.source_group_id = "user-id"; }],
    ["action order", (d: any) => { d.task.atomic_actions.reverse(); }],
    ["invalid mapping", (d: any) => { d.task.tools[0].mapping_status = "matched"; }],
  ])("rejects %s", (_name, mutate) => {
    const doc = buildTaskSegmentAnnotation(segmentAnnotationFixture(), 1);
    mutate(doc);
    expect(taskSegmentAnnotationSchema.safeParse(doc).success).toBe(false);
  });

  it.each(["assetId", "revision", "videoSha256"] as const)("checks %s against external binding", field => {
    const input = segmentAnnotationFixture();
    const doc = buildTaskSegmentAnnotation(input, 1);
    const binding = { assetId: input.asset.id, revision: 1, videoSha256: input.asset.clipSha256! };
    Object.assign(binding, { [field]: field === "revision" ? 2 : "different" });
    expect(() => validateSegmentAnnotation(doc, binding)).toThrow("SEGMENT_MEDIA_BINDING_INVALID");
  });

  it("preserves unknown instead of treating it as success or absence", () => {
    const input = segmentAnnotationFixture();
    const task = (input.accepted.effective.tasks as any[])[0];
    task.effective_result_status = "unknown";
    task.effective_failure_recovery = "not_assessable";
    const doc = buildTaskSegmentAnnotation(input, 1);
    expect(doc.task.result.effective_status).toBe("unknown");
    expect(doc.task.result.model_status).toBe("success");
    expect(doc.task.failure_recovery.effective_status).toBe("not_assessable");
  });

  it("uses actualStart for stream copy, including one-sided refinement", () => {
    const input = segmentAnnotationFixture();
    input.asset.actualStartMs = 39467;
    input.asset.clipDurationMs = 11033;
    input.asset.materializationMode = "stream_copy";
    input.asset.refinedStartMs = 41000;
    input.asset.boundarySource = "refined";
    const doc = buildTaskSegmentAnnotation(input, 1);
    expect(doc.task.evidence_timestamps_ms[0]).toBe(2533);
    expect(doc.provenance.refined_task_interval_ms).toEqual([41000, 50000]);
    expect(sourceToClipTimestamp(42000, 39500)).toBe(2500);
  });

  it.each([39499, 50501])("never clamps outside evidence at %s", timestamp => {
    const input = segmentAnnotationFixture();
    (input.accepted.effective.tasks as any[])[0].result_evidence_timestamps_ms = [timestamp];
    expect(() => buildTaskSegmentAnnotation(input, 1)).toThrow("EVIDENCE_OUTSIDE_CLIP");
  });

  it("canonicalizes recursively, keeps array order, and hashes actual UTF-8 bytes", () => {
    expect(canonicalSegmentJson({ z: [2, 1], a: { z: 1, a: 2 } })).toBe(canonicalSegmentJson({ a: { a: 2, z: 1 }, z: [2, 1] }));
    const value = canonicalSegmentJson({ text: "杯子" });
    expect(value.endsWith("\n") && !value.endsWith("\n\n")).toBe(true);
    expect(segmentJsonSha256(value)).toBe(segmentJsonSha256(Buffer.from(value, "utf8")));
    expect(() => canonicalSegmentJson({ value: Infinity })).toThrow("SEGMENT_JSON_SERIALIZATION_FAILED");
  });

  it("fingerprints all emitted content but not wall-clock time", () => {
    const input = segmentAnnotationFixture();
    const before = taskSegmentSourceFingerprint(input);
    input.asset.updatedAt = new Date(0);
    expect(taskSegmentSourceFingerprint(input)).toBe(before);
    (input.accepted.effective.tasks as any[])[0].tools = ["刷子"];
    expect(taskSegmentSourceFingerprint(input)).not.toBe(before);
  });

  it.each(["scene-evidence", "task-policy", "mapping-confidence", "object-key"])("fingerprints the complete source snapshot: %s", change => {
    const input = segmentAnnotationFixture();
    const before = taskSegmentSourceFingerprint(input);
    if (change === "scene-evidence") (input.accepted.effective.scene as any).evidence_timestamps_ms = [1000];
    if (change === "task-policy") (input.accepted.effective.tasks as any[])[0].policy_reasons = ["reviewed"];
    if (change === "mapping-confidence") (input.accepted.labelMappings[0] as any).confidence = 0.8;
    if (change === "object-key") input.asset.clipObjectKey = "legacy/clip.mp4";
    expect(taskSegmentSourceFingerprint(input)).not.toBe(before);
  });
});

describe("task evidence envelope", () => {
  it.each([
    "evidence_timestamps_ms", "result_evidence_timestamps_ms", "failure_evidence_timestamps_ms", "recovery_evidence_timestamps_ms",
  ])("expands for %s and keeps padding", field => {
    const input = segmentAnnotationFixture();
    (input.accepted.effective.tasks as any[])[0][field] = [38000, 52000];
    const evidence = collectTaskSegmentEvidence({ effective: input.accepted.effective, taskIndex: 0, durationMs: 60000 });
    expect(taskSegmentTargetBounds({ startMs: 40000, endMs: 50000, durationMs: 60000, evidenceTimestampsMs: evidence }))
      .toEqual({ clipStartMs: 37500, clipEndMs: 52500, tooShort: false });
  });

  it("includes atomic actions and linked coverage but excludes scene and other tasks", () => {
    const input = segmentAnnotationFixture();
    const effective = input.accepted.effective as any;
    effective.tasks[0].atomic_action_sequence[0].evidence_timestamps_ms = [37000];
    effective.coverage_segments[0].end_ms = 53000;
    effective.tasks.push(structuredClone(effective.tasks[0]));
    effective.coverage_segments.push({ ...effective.coverage_segments[0], linked_task_index: 1, end_ms: 59000 });
    const evidence = collectTaskSegmentEvidence({ effective, taskIndex: 0, durationMs: 60000 });
    expect(Math.min(...evidence)).toBe(37000);
    expect(Math.max(...evidence)).toBe(53000);
  });

  it.each([NaN, Infinity, -1, 60001, "42000"])("rejects invalid evidence %s", value => {
    const input = segmentAnnotationFixture();
    (input.accepted.effective.tasks as any[])[0].evidence_timestamps_ms = [value];
    expect(() => collectTaskSegmentEvidence({ effective: input.accepted.effective, taskIndex: 0, durationMs: 60000 }))
      .toThrow("SEGMENT_EVIDENCE_INVALID");
  });

  it("rejects broken coverage references and preserves the minimum length rule", () => {
    const input = segmentAnnotationFixture();
    (input.accepted.effective.coverage_segments as any[])[0].linked_task_index = 9;
    expect(() => collectTaskSegmentEvidence({ effective: input.accepted.effective, taskIndex: 0, durationMs: 60000 })).toThrow("SEGMENT_EVIDENCE_INVALID");
    expect(taskSegmentTargetBounds({ startMs: 500, endMs: 1000, durationMs: 60000 }).tooShort).toBe(true);
  });
});
