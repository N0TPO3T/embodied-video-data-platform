import { describe, expect, it } from "vitest";

import { normalizeVideoQcResult } from "../src/video-quality/video-qc-rule-engine.js";
import type {
  PreparedVideoEvidence,
  RawQualityDimension,
  RawVideoQcResultV1,
  VideoQcInputV1,
} from "../src/video-quality/video-quality.types.js";
import { buildVideoQcInput } from "../src/video-quality/video-qc-input.js";

const rawDimensionKeys: Array<keyof RawVideoQcResultV1["dimensions"]> = [
  "D1",
  "D2",
  "D3",
  "D4",
  "D5",
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

function dimension(coefficient: number): RawQualityDimension {
  return {
    coefficient,
    score: Number((20 * coefficient).toFixed(1)),
    confidence: 0.95,
    metrics: {},
    issues: [],
  };
}

function rawAt(
  score: number,
  status: RawVideoQcResultV1["evaluation_status"] = "completed",
): RawVideoQcResultV1 {
  const coefficient = score / 100;
  const dimensions = Object.fromEntries(
    rawDimensionKeys.map((key) => [key, dimension(coefficient)]),
  ) as RawVideoQcResultV1["dimensions"];
  return {
    schema_version: "video_qc_v1",
    rule_version: "video_qc_v1",
    prompt_version: "qwen_video_qc_prompt_v2",
    task_id: "LAB-1",
    evaluation_status: status,
    input_status: {
      is_complete: true,
      missing_required_inputs: [],
      conflicts: [],
    },
    task_summary: "test",
    overall_result: {
      raw_total_score: score,
      final_score: score,
      summary: "test",
    },
    hard_reject: {
      triggered: status === "hard_reject",
      reasons: status === "hard_reject" ? ["FAKE_OR_NON_TASK"] : [],
      candidates: [],
    },
    dimensions,
    review: {
      review_required: false,
      review_reasons: [],
    },
    duration_result: {
      analysis_duration_ms: 10_000,
      invalid_duration_ms: 2_000,
      effective_duration_ms: 8_000,
      effective_duration_ratio: 0.8,
      invalid_segments: [],
      necessary_wait_segments: [],
    },
    recommendations: [],
  };
}

function normalize(raw: RawVideoQcResultV1, sourceEvidence = evidence()) {
  const sourceInput: VideoQcInputV1 = buildVideoQcInput({
    videoId: raw.task_id,
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
    expect(normalize(rawAt(60)).settlementRatio).toBe(0.7);
    expect(normalize(rawAt(40)).settlementRatio).toBe(0);
    expect(normalize(rawAt(39.9)).settlementRatio).toBe(0);
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
    raw.duration_result.invalid_segments.push({
      reason_code: "UNRELATED_CONTENT",
      description: "unrelated",
      start_ms: 2_000,
      end_ms: 4_000,
      confidence: 0.95,
      evidence_timestamps_ms: [2_500],
    });
    raw.duration_result.invalid_duration_ms = 3_000;
    raw.duration_result.effective_duration_ms = 7_000;
    raw.duration_result.effective_duration_ratio = 0.7;

    const result = normalize(raw);

    expect(result.invalidDurationMs).toBe(3_000);
    expect(result.billableDurationMs).toBe(7_000);
  });

  it("recomputes scores and makes evidence-free deductions non-settleable", () => {
    const raw = rawAt(80);
    raw.dimensions.D1.score = 20;
    raw.dimensions.D1.issues.push({
      reason_code: "NON_FIRST_PERSON",
      description: "no evidence",
      start_ms: 0,
      end_ms: 5_000,
      severity: "major",
      confidence: 0.9,
      evidence_timestamps_ms: [],
      source: "visual_model",
    });

    const result = normalize(raw);

    expect(result.dimensions.first_person_and_composition.score).toBe(16);
    expect(result.evaluationStatus).toBe("review_pending");
    expect(result.settlementRatio).toBeNull();
    expect(result.validation.errors.join(" ")).toContain("证据");
  });

  it("uses the unrounded dimension values before final rounding", () => {
    const raw = rawAt(0);
    for (const key of rawDimensionKeys) {
      raw.dimensions[key].coefficient = 0.333;
      raw.dimensions[key].score = 6.7;
    }
    raw.overall_result.raw_total_score = 33.3;
    raw.overall_result.final_score = 33.3;

    expect(normalize(raw).finalScore).toBe(33.3);
  });
});
