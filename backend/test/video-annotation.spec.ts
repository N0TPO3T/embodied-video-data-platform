import { describe, expect, it } from "vitest";

import {
  normalizeVideoAnnotation,
  parseRawVideoAnnotation,
  type RawVideoAnnotation,
} from "../src/video-annotation/video-annotation.js";

function rawAnnotation(): RawVideoAnnotation {
  return {
    schema_version: "ego_video_annotation_v1",
    video_id: "video-1",
    video_summary: "将杯子放到桌面右侧。",
    scene: {
      coarse_label: "indoor",
      fine_label: "kitchen",
      confidence: 0.9,
      evidence_timestamps_ms: [0, 1_000],
    },
    temporal_structure_type: "single_task",
    tasks: [
      {
        start_ms: 0,
        end_ms: 1_000,
        task_label: "放置杯子",
        task_verb: "pick_and_place",
        task_object: "杯子",
        evidence_level: "direct_visual",
        evidence_timestamps_ms: [0, 500, 1_000],
        manipulated_objects: ["杯子"],
        tools: [],
        hand_mode: "right",
        interaction_primitives: ["grasp", "place"],
        completion: "complete",
        result_observability: "visible",
        result_status: "success",
        visible_postcondition: "杯子位于桌面右侧。",
        result_evidence_timestamps_ms: [1_000],
        failure_recovery: "none_observed",
        uncertainty_reasons: [],
        confidence: 0.9,
      },
    ],
    global_limitations: [],
  };
}

function normalize(
  raw: RawVideoAnnotation,
  timestampsMs: number[],
) {
  return normalizeVideoAnnotation({
    raw,
    frames: timestampsMs.map((timestampMs) => ({
      timestampMs,
      dataUrl: "data:image/jpeg;base64,AA==",
    })),
    durationMs: 1_000,
    promptVersion: "prompt-v1",
    promptContentSha256: "a".repeat(64),
    model: "test-model",
    requestId: "request-1",
    modelDurationMs: 12,
  });
}

describe("video annotation evidence policy", () => {
  it("keeps directly supported dense annotations as candidates", () => {
    const result = normalize(rawAnnotation(), [0, 500, 1_000]);

    expect(result.status).toBe("candidate");
    expect(result.validation.errors).toEqual([]);
    expect(result.effective.tasks[0]).toMatchObject({
      effective_completion: "complete",
      effective_result_status: "success",
      effective_failure_recovery: "none_observed",
      policy_reasons: [],
    });
  });

  it("conservatively downgrades outcome claims under sparse sampling", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.end_ms = 5_000;
    raw.tasks[0]!.evidence_timestamps_ms = [0, 5_000];
    raw.tasks[0]!.result_evidence_timestamps_ms = [5_000];
    raw.scene.evidence_timestamps_ms = [0, 5_000];

    const result = normalizeVideoAnnotation({
      raw,
      frames: [0, 5_000].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      durationMs: 5_000,
      promptVersion: "prompt-v1",
      promptContentSha256: "a".repeat(64),
      model: "test-model",
      requestId: null,
      modelDurationMs: 12,
    });

    expect(result.status).toBe("review_required");
    expect(result.effective.tasks[0]).toMatchObject({
      effective_completion: "uncertain",
      effective_result_status: "unknown",
      effective_failure_recovery: "not_assessable",
    });
    expect(result.effective.tasks[0]!.policy_reasons).toEqual(
      expect.arrayContaining([
        "sparse_sampling_cannot_verify_completion",
        "sparse_sampling_cannot_verify_outcome",
        "sparse_sampling_cannot_verify_failure_recovery",
      ]),
    );
  });

  it("rejects hallucinated evidence timestamps into human review", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.result_evidence_timestamps_ms = [750];

    const result = normalize(raw, [0, 500, 1_000]);

    expect(result.status).toBe("review_required");
    expect(result.validation.errors.join(" ")).toContain(
      "未提供的结果证据时间点 750",
    );
  });

  it("strictly rejects unknown output fields", () => {
    expect(() =>
      parseRawVideoAnnotation({ ...rawAnnotation(), pass: true }),
    ).toThrow();
  });

  it("maps exact controlled labels and keeps unknown values as proposals", () => {
    const result = normalizeVideoAnnotation({
      raw: rawAnnotation(),
      frames: [0, 500, 1_000].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      durationMs: 1_000,
      promptVersion: "prompt-v1",
      promptContentSha256: "a".repeat(64),
      model: "test-model",
      requestId: null,
      modelDurationMs: 12,
      enabledLabels: [
        { id: "scene-1", name: "Kitchen", type: "scene" },
        { id: "object-1", name: "杯子", type: "object" },
      ],
    });

    expect(result.labelMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "scene",
          status: "matched",
          labelId: "scene-1",
        }),
        expect.objectContaining({
          type: "object",
          status: "matched",
          labelId: "object-1",
        }),
        expect.objectContaining({
          type: "action",
          status: "proposed",
          labelId: null,
        }),
      ]),
    );
  });
});
