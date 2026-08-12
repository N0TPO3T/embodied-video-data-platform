import { describe, expect, it } from "vitest";

import { normalizeVideoQcResult } from "../src/video-quality/video-qc-rule-engine.js";
import type {
  DimensionKey,
  PreparedVideoEvidence,
  RawVideoQcResultV1,
  VideoQcInputV1,
} from "../src/video-quality/video-quality.types.js";
import { buildVideoQcInput } from "../src/video-quality/video-qc-input.js";

const dimensionKeys: DimensionKey[] = [
  "first_person_and_composition",
  "hand_forearm_object_integrity",
  "frame_and_video_quality",
  "task_authenticity_completeness",
  "task_value_uniqueness",
];

function evidence(): PreparedVideoEvidence {
  return {
    sha256: "b".repeat(64),
    metadata: {
      display_width: 1920,
      display_height: 1080,
      display_aspect_ratio: 16 / 9,
      duration_ms: 10_000,
      nominal_fps: 60,
      effective_fps: 60,
      codec: "h264",
      bitrate_bps: 1_000_000,
      file_size_bytes: 10_000,
      rotation_degrees: 0,
    },
    technicalMetrics: {
      decodable: true,
      decoded_duration_ms: 10_000,
      black_ratio: 0.2,
      freeze_ratio: 0,
      blur_ratio: 0,
      underexposure_ratio: 0,
      overexposure_ratio: 0,
      timestamp_discontinuity_ratio: 0,
      detector_windows: [
        {
          type: "black",
          start_ms: 1_000,
          end_ms: 3_000,
          confidence: 1,
          source: "ffmpeg",
        },
      ],
    },
    fullVideoFrames: [],
    fullVideoSamplingFps: 0.2,
    missingMetrics: [],
  };
}

function rawAt(
  score: number,
  status: RawVideoQcResultV1["evaluation_status"] = "scored",
): RawVideoQcResultV1 {
  const coefficient = score / 100;
  const dimensions = Object.fromEntries(
    dimensionKeys.map((key) => [
      key,
      {
        coefficient,
        score: Number((20 * coefficient).toFixed(1)),
        confidence: 0.95,
        calculation_trace: "20 × coefficient",
        segments: [],
        issues: [],
      },
    ]),
  ) as unknown as RawVideoQcResultV1["dimensions"];
  return {
    schema_version: "video_qc_result_v1",
    rule_version: "video_qc_v1",
    prompt_version: "qwen_video_qc_prompt_v1",
    video_id: "LAB-1",
    evaluation_status: status,
    hard_veto: {
      triggered: status === "hard_reject",
      reasons: status === "hard_reject" ? ["FAKE_OR_NON_TASK"] : [],
    },
    detected_task: {
      scene_id: "",
      task_id: "",
      variant_id: "",
      task_summary: "test",
      confidence: 0.95,
    },
    dimensions,
    billing_observations: {
      candidate_invalid_segments: [],
      candidate_valid_waiting_segments: [],
    },
    raw_total_score: score,
    final_score: score,
    summary: "test",
    deductions: [],
    recommendations: [],
    review_required: false,
    review_reasons: [],
    missing_inputs: [],
  };
}

function normalize(raw: RawVideoQcResultV1, sourceEvidence = evidence()) {
  const sourceInput: VideoQcInputV1 = buildVideoQcInput({
    videoId: raw.video_id,
    evidence: sourceEvidence,
    exactBatchDuplicate: false,
  });
  return normalizeVideoQcResult({
    raw,
    sourceInput,
    evidence: sourceEvidence,
    modelRuns: [],
  });
}

describe("video_qc_v1 rule engine", () => {
  it("maps exact score boundaries to the confirmed four bands", () => {
    expect(normalize(rawAt(80)).settlementRatio).toBe(1);
    expect(normalize(rawAt(60)).settlementRatio).toBe(0.8);
    expect(normalize(rawAt(40)).settlementRatio).toBe(0.6);
    expect(normalize(rawAt(39.9)).settlementRatio).toBe(0.4);
  });

  it("keeps a hard reject score but forces zero settlement", () => {
    const result = normalize(rawAt(88, "hard_reject"));

    expect(result.finalScore).toBe(88);
    expect(result.evaluationStatus).toBe("hard_reject");
    expect(result.settlementRatio).toBe(0);
  });

  it("does not settle incomplete or review-pending results", () => {
    expect(
      normalize(rawAt(88, "incomplete_input")).settlementRatio,
    ).toBeNull();
    expect(
      normalize(rawAt(88, "review_pending")).settlementRatio,
    ).toBeNull();
  });

  it("unions deterministic and semantic invalid intervals", () => {
    const raw = rawAt(80);
    raw.billing_observations.candidate_invalid_segments.push({
      reason_code: "UNRELATED_CONTENT",
      description: "unrelated",
      start_ms: 2_000,
      end_ms: 4_000,
      confidence: 0.95,
      evidence_timestamps_ms: [2_500],
    });

    const result = normalize(raw);

    expect(result.invalidDurationMs).toBe(3_000);
    expect(result.billableDurationMs).toBe(7_000);
  });

  it("recomputes scores and makes evidence-free deductions non-settleable", () => {
    const raw = rawAt(80);
    raw.dimensions.first_person_and_composition.score = 20;
    raw.deductions.push({
      dimension: "D1",
      reason_code: "NON_FIRST_PERSON",
      description: "no evidence",
      start_ms: 0,
      end_ms: 5_000,
      severity: "major",
      confidence: 0.9,
      evidence_timestamps_ms: [],
    });

    const result = normalize(raw);

    expect(result.dimensions.first_person_and_composition.score).toBe(16);
    expect(result.evaluationStatus).toBe("review_pending");
    expect(result.settlementRatio).toBeNull();
    expect(result.validation.errors.join(" ")).toContain("证据");
  });

  it("uses the unrounded dimension values before final rounding", () => {
    const raw = rawAt(0);
    for (const key of dimensionKeys) {
      raw.dimensions[key].coefficient = 0.333;
      raw.dimensions[key].score = 6.7;
    }
    raw.raw_total_score = 33.3;
    raw.final_score = 33.3;

    expect(normalize(raw).finalScore).toBe(33.3);
  });
});
