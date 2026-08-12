import type {
  DimensionKey,
  ModelRunMetadata,
  NormalizedVideoQcResultV1,
  PreparedVideoEvidence,
  QualityDimension,
  RawVideoQcResultV1,
  VideoQcInputV1,
} from "./video-quality.types.js";

export type NormalizeVideoQcInput = {
  raw: RawVideoQcResultV1;
  sourceInput: VideoQcInputV1;
  evidence: PreparedVideoEvidence;
  modelRuns: ModelRunMetadata[];
};

const dimensionKeys: DimensionKey[] = [
  "first_person_and_composition",
  "hand_forearm_object_integrity",
  "frame_and_video_quality",
  "task_authenticity_completeness",
  "task_value_uniqueness",
];

function roundOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function nearlyEqual(left: number, right: number, tolerance = 0.05): boolean {
  return Math.abs(left - right) <= tolerance;
}

function scoreBand(score: number): number {
  if (score >= 80) return 1;
  if (score >= 60) return 0.8;
  if (score >= 40) return 0.6;
  return 0.4;
}

type Interval = { startMs: number; endMs: number };

function unionDuration(intervals: Interval[]): number {
  const sorted = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  let total = 0;
  let current: Interval | null = null;
  for (const interval of sorted) {
    if (!current) {
      current = { ...interval };
    } else if (interval.startMs <= current.endMs) {
      current.endMs = Math.max(current.endMs, interval.endMs);
    } else {
      total += current.endMs - current.startMs;
      current = { ...interval };
    }
  }
  if (current) total += current.endMs - current.startMs;
  return total;
}

function clippedInterval(
  startMs: number,
  endMs: number,
  durationMs: number,
): Interval | null {
  const start = Math.max(0, Math.min(durationMs, startMs));
  const end = Math.max(0, Math.min(durationMs, endMs));
  return end > start ? { startMs: start, endMs: end } : null;
}

export function normalizeVideoQcResult(
  input: NormalizeVideoQcInput,
): NormalizedVideoQcResultV1 {
  const errors: string[] = [];
  const warnings: string[] = [];
  const durationMs = input.sourceInput.analysis_duration_ms;
  const normalizedDimensions = {} as Record<DimensionKey, QualityDimension>;
  let unroundedTotal = 0;

  for (const key of dimensionKeys) {
    const dimension = input.raw.dimensions[key];
    const unroundedScore = 20 * dimension.coefficient;
    const score = roundOne(unroundedScore);
    unroundedTotal += unroundedScore;
    if (!nearlyEqual(dimension.score, score)) {
      errors.push(`${key} 的模型分数与 20 × 系数不一致`);
    }
    for (const issue of dimension.issues) {
      if (issue.evidence_timestamps_ms.length === 0) {
        errors.push(`${key}/${issue.reason_code} 缺少证据时间点`);
      }
    }
    normalizedDimensions[key] = { ...dimension, score };
  }

  const finalScore = roundOne(Math.max(0, Math.min(100, unroundedTotal)));
  if (!nearlyEqual(input.raw.raw_total_score, roundOne(unroundedTotal))) {
    errors.push("模型 raw_total_score 与五个未舍入分项之和不一致");
  }
  if (!nearlyEqual(input.raw.final_score, finalScore)) {
    errors.push("模型 final_score 与服务端复算结果不一致");
  }

  const reasonDimensions = new Map<string, string>();
  for (const deduction of input.raw.deductions) {
    if (deduction.evidence_timestamps_ms.length === 0) {
      errors.push(`${deduction.reason_code} 扣分缺少证据时间点`);
    }
    if (deduction.start_ms >= deduction.end_ms) {
      errors.push(`${deduction.reason_code} 的时间区间无效`);
    }
    if (
      deduction.end_ms > durationMs ||
      deduction.evidence_timestamps_ms.some(
        (timestamp) => timestamp < 0 || timestamp > durationMs,
      )
    ) {
      errors.push(`${deduction.reason_code} 的证据超出视频时间轴`);
    }
    const dimension = deduction.dimension ?? "unknown";
    const previous = reasonDimensions.get(deduction.reason_code);
    if (previous && previous !== dimension) {
      errors.push(`${deduction.reason_code} 在多个维度重复扣分`);
    }
    reasonDimensions.set(deduction.reason_code, dimension);
  }

  if (input.raw.hard_veto.triggered !== (input.raw.evaluation_status === "hard_reject")) {
    errors.push("hard_veto 与 evaluation_status 不一致");
  }
  if (
    input.raw.hard_veto.reasons.some((reason) => reason === "EXACT_DUPLICATE") &&
    !input.sourceInput.similarity_context.file_hash_exact
  ) {
    errors.push("EXACT_DUPLICATE 缺少权威文件哈希依据");
  }

  const invalidSegments: NormalizedVideoQcResultV1["invalidSegments"] = [];
  for (const window of input.evidence.technicalMetrics.detector_windows) {
    if (window.type !== "black" && window.type !== "freeze") continue;
    const clipped = clippedInterval(window.start_ms, window.end_ms, durationMs);
    if (clipped) {
      invalidSegments.push({
        reasonCode: window.type === "black" ? "BLACK_SCREEN" : "FREEZE",
        ...clipped,
        source: "detector",
      });
    }
  }
  for (const segment of input.raw.billing_observations.candidate_invalid_segments) {
    if (segment.evidence_timestamps_ms.length === 0) {
      errors.push(`${segment.reason_code} 无效片段缺少证据时间点`);
    }
    const clipped = clippedInterval(segment.start_ms, segment.end_ms, durationMs);
    if (!clipped) {
      errors.push(`${segment.reason_code} 无效片段时间范围无效`);
      continue;
    }
    invalidSegments.push({
      reasonCode: segment.reason_code,
      ...clipped,
      source: "model",
    });
  }

  const invalidDurationMs = unionDuration(invalidSegments);
  const billableDurationMs = Math.max(0, durationMs - invalidDurationMs);
  let evaluationStatus = input.raw.evaluation_status;
  if (errors.length > 0) {
    evaluationStatus = "review_pending";
  }
  const settlementRatio =
    evaluationStatus === "hard_reject"
      ? 0
      : evaluationStatus === "scored"
        ? scoreBand(finalScore)
        : null;

  if (input.raw.review_required && input.raw.review_reasons.length === 0) {
    warnings.push("模型要求复核但没有给出复核原因");
  }

  return {
    schemaVersion: "video_qc_result_v1",
    ruleVersion: "video_qc_v1",
    promptVersion: "qwen_video_qc_prompt_v1",
    videoId: input.raw.video_id,
    evaluationStatus,
    dimensions: normalizedDimensions,
    rawTotalScore: unroundedTotal,
    finalScore,
    settlementRatio,
    analysisDurationMs: durationMs,
    invalidDurationMs,
    billableDurationMs,
    invalidSegments,
    hardVeto: input.raw.hard_veto,
    detectedTask: input.raw.detected_task,
    deductions: input.raw.deductions,
    recommendations: input.raw.recommendations,
    summary: input.raw.summary,
    reviewRequired: input.raw.review_required || errors.length > 0,
    reviewReasons: [
      ...input.raw.review_reasons,
      ...(errors.length > 0 ? ["服务端规则校验未通过"] : []),
    ],
    missingInputs: [...new Set([...input.sourceInput.missing_inputs, ...input.raw.missing_inputs])],
    validation: { warnings, errors },
    rawModelResult: input.raw,
    modelRuns: input.modelRuns,
    media: {
      metadata: input.evidence.metadata,
      technicalMetrics: input.evidence.technicalMetrics,
      fullVideoSamplingFps: input.evidence.fullVideoSamplingFps,
      fullVideoFrameCount: input.evidence.fullVideoFrames.length,
    },
  };
}
