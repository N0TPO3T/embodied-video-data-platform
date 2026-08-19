import type {
  DimensionKey,
  ModelRunMetadata,
  NormalizedVideoQcResultV1,
  PreparedVideoEvidence,
  QualityDimension,
  QualityIssue,
  RawDimensionKey,
  RawQualityIssue,
  RawVideoQcResultV1,
  VideoQcInputV1,
} from "./video-quality.types.js";
import {
  VIDEO_QC_PROMPT_VERSION,
  VIDEO_QC_RESULT_SCHEMA,
  VIDEO_QC_RULE_VERSION,
} from "./video-quality.types.js";
import { coefficientForScore } from "../rules/rule-calculator.js";

export type NormalizeVideoQcInput = {
  raw: RawVideoQcResultV1;
  sourceInput: VideoQcInputV1;
  evidence: PreparedVideoEvidence;
  modelRuns: ModelRunMetadata[];
};

const RAW_DIMENSION_KEYS: RawDimensionKey[] = ["D1", "D2", "D3", "D4", "D5"];

const DIMENSION_BY_RAW: Record<RawDimensionKey, DimensionKey> = {
  D1: "first_person_and_composition",
  D2: "hand_forearm_object_integrity",
  D3: "frame_and_video_quality",
  D4: "task_authenticity_completeness",
  D5: "task_value_uniqueness",
};

const dimensionKeys: DimensionKey[] = [
  "first_person_and_composition",
  "hand_forearm_object_integrity",
  "frame_and_video_quality",
  "task_authenticity_completeness",
  "task_value_uniqueness",
];

const DIMENSION_SPECIAL_METRICS: Record<
  DimensionKey,
  Array<{ field: keyof Pick<QualityDimension, "hand_active_duration_ms" | "c_spec" | "c_visual" | "completion_coefficient" | "inventory_coefficient" | "unique_coefficient" | "similarity_total">; metricKey: string }>
> = {
  first_person_and_composition: [],
  hand_forearm_object_integrity: [
    { field: "hand_active_duration_ms", metricKey: "hand_active_duration_ms" },
  ],
  frame_and_video_quality: [
    { field: "c_spec", metricKey: "C_spec" },
    { field: "c_visual", metricKey: "C_visual" },
  ],
  task_authenticity_completeness: [
    { field: "completion_coefficient", metricKey: "C_completion" },
  ],
  task_value_uniqueness: [
    { field: "inventory_coefficient", metricKey: "C_inventory" },
    { field: "unique_coefficient", metricKey: "C_unique" },
    { field: "similarity_total", metricKey: "S_total" },
  ],
};

function roundOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function nearlyEqual(left: number | null, right: number | null, tolerance = 0.05): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= tolerance;
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
  startMs: number | null,
  endMs: number | null,
  durationMs: number | null,
): Interval | null {
  if (startMs === null || endMs === null || durationMs === null) return null;
  const start = Math.max(0, Math.min(durationMs, startMs));
  const end = Math.max(0, Math.min(durationMs, endMs));
  return end > start ? { startMs: start, endMs: end } : null;
}

function rawIssueToQualityIssue(
  issue: RawQualityIssue,
  durationMs: number | null,
  errors: string[],
  context: string,
): QualityIssue | null {
  if (issue.start_ms !== null && issue.end_ms !== null) {
    if (issue.start_ms >= issue.end_ms) {
      errors.push(`${context}/${issue.reason_code} 的时间区间无效`);
      return null;
    }
    if (durationMs !== null && issue.end_ms > durationMs) {
      errors.push(`${context}/${issue.reason_code} 的证据超出视频时间轴`);
      return null;
    }
    if (
      issue.evidence_timestamps_ms.some(
        (timestamp) => timestamp < issue.start_ms! || timestamp > issue.end_ms!,
      )
    ) {
      errors.push(`${context}/${issue.reason_code} 的证据时间未位于问题区间内`);
    }
  } else if (issue.evidence_timestamps_ms.length > 0) {
    errors.push(`${context}/${issue.reason_code} 非时序问题不应带证据时间点`);
  }
  if (issue.evidence_timestamps_ms.length === 0 && issue.start_ms !== null) {
    errors.push(`${context}/${issue.reason_code} 扣分缺少证据时间点`);
  }
  return {
    reason_code: issue.reason_code,
    description: issue.description,
    start_ms: issue.start_ms,
    end_ms: issue.end_ms,
    severity: issue.severity,
    confidence: issue.confidence,
    evidence_timestamps_ms: issue.evidence_timestamps_ms,
  };
}

export function normalizeVideoQcResult(
  input: NormalizeVideoQcInput,
): NormalizedVideoQcResultV1 {
  const errors: string[] = [];
  const warnings: string[] = [];
  const durationMs = input.sourceInput.analysis_duration_ms;
  const normalizedDimensions = {} as Record<DimensionKey, QualityDimension>;
  const deductions: Array<QualityIssue & { dimension?: string }> = [];
  const unroundedScores = new Map<RawDimensionKey, number | null>();

  for (const rawKey of RAW_DIMENSION_KEYS) {
    const key = DIMENSION_BY_RAW[rawKey];
    const dimension = input.raw.dimensions[rawKey];
    const context = `${rawKey}（${key}）`;
    const unroundedScore =
      dimension.coefficient === null
        ? null
        : 20 * dimension.coefficient;
    unroundedScores.set(rawKey, unroundedScore);

    if (dimension.coefficient !== null && dimension.score !== null) {
      if (!nearlyEqual(dimension.score, roundOne(unroundedScore!))) {
        errors.push(`${context} 的模型分数与 20 × 系数不一致`);
      }
    } else if (dimension.coefficient === null && dimension.score === null) {
      errors.push(`${context} 缺少必需评分数据（coefficient 与 score 均为空）`);
    }

    const issues: QualityIssue[] = [];
    for (const issue of dimension.issues) {
      const normalized = rawIssueToQualityIssue(
        issue,
        durationMs,
        errors,
        context,
      );
      if (normalized) issues.push(normalized);
    }
    deductions.push(
      ...issues.map((issue) => ({ ...issue, dimension: key })),
    );

    const special: Partial<QualityDimension> = {};
    for (const { field, metricKey } of DIMENSION_SPECIAL_METRICS[key]) {
      const value = dimension.metrics[metricKey] ?? null;
      if (value !== null && Number.isFinite(value)) {
        (special as Record<string, unknown>)[field] = value;
      }
    }

    normalizedDimensions[key] = {
      coefficient: dimension.coefficient,
      score:
        unroundedScore === null ? null : roundOne(unroundedScore),
      confidence: dimension.confidence,
      calculation_trace:
        dimension.metrics && Object.keys(dimension.metrics).length > 0
          ? JSON.stringify(dimension.metrics)
          : "",
      segments: [],
      issues,
      metrics: dimension.metrics,
      ...special,
    };
  }

  const rawTotal =
    input.raw.overall_result.raw_total_score === null
      ? null
      : Number(input.raw.overall_result.raw_total_score);
  const reportedFinal = input.raw.overall_result.final_score;
  const unroundedTotal = [...unroundedScores.values()].reduce<number | null>(
    (total, score) => {
      if (score === null) return null;
      return total === null ? score : total + score;
    },
    0,
  );
  const finalScore =
    unroundedTotal === null
      ? null
      : roundOne(Math.max(0, Math.min(100, unroundedTotal)));

  if (unroundedTotal === null) {
    errors.push("任一必需维度无法计算，总分应为空");
  } else if (
    rawTotal !== null &&
    !nearlyEqual(rawTotal, roundOne(unroundedTotal))
  ) {
    errors.push("模型 raw_total_score 与五个未舍入分项之和不一致");
  }
  if (finalScore !== null && reportedFinal !== null && !nearlyEqual(reportedFinal, finalScore)) {
    errors.push("模型 final_score 与服务端复算结果不一致");
  }

  const reasonDimensions = new Map<string, string>();
  for (const deduction of deductions) {
    const previous = reasonDimensions.get(deduction.reason_code);
    if (previous && previous !== deduction.dimension) {
      errors.push(`${deduction.reason_code} 在多个维度重复扣分`);
    }
    reasonDimensions.set(deduction.reason_code, deduction.dimension ?? "unknown");
  }

  if (input.raw.hard_reject.triggered !== (input.raw.evaluation_status === "hard_reject")) {
    errors.push("hard_reject 与 evaluation_status 不一致");
  }
  if (
    input.raw.hard_reject.reasons.some((reason) => reason === "EXACT_DUPLICATE") &&
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
  for (const segment of input.raw.duration_result.invalid_segments) {
    if (segment.evidence_timestamps_ms.length === 0) {
      errors.push(`${segment.reason_code} 无效片段缺少证据时间点`);
    }
    const clipped = clippedInterval(segment.start_ms, segment.end_ms, durationMs);
    if (!clipped) {
      if (segment.start_ms !== null || segment.end_ms !== null) {
        errors.push(`${segment.reason_code} 无效片段时间范围无效`);
      }
      continue;
    }
    invalidSegments.push({
      reasonCode: segment.reason_code,
      ...clipped,
      source: "model",
    });
  }

  const invalidDurationMs =
    durationMs === null ? null : unionDuration(invalidSegments);
  const billableDurationMs =
    durationMs === null || invalidDurationMs === null
      ? null
      : Math.max(0, durationMs - invalidDurationMs);
  if (
    input.raw.duration_result.effective_duration_ms !== null &&
    billableDurationMs !== null &&
    Math.abs(input.raw.duration_result.effective_duration_ms - billableDurationMs) > 1_000
  ) {
    errors.push("模型 effective_duration_ms 与服务端复算结果不一致");
  }

  let evaluationStatus: NormalizedVideoQcResultV1["evaluationStatus"] =
    input.raw.evaluation_status === "completed"
      ? "scored"
      : input.raw.evaluation_status;
  if (errors.length > 0) {
    evaluationStatus = "review_pending";
  }
  const settlementRatio =
    evaluationStatus === "hard_reject"
      ? 0
      : evaluationStatus === "scored"
        ? coefficientForScore(finalScore ?? 0)
        : null;

  if (input.raw.review.review_required && input.raw.review.review_reasons.length === 0) {
    warnings.push("模型要求复核但没有给出复核原因");
  }

  const reviewReasons = [...input.raw.review.review_reasons];
  if (
    input.raw.hard_reject.candidates.length > 0 &&
    input.raw.evaluation_status !== "hard_reject"
  ) {
    reviewReasons.push(
      `疑似硬性否决候选：${input.raw.hard_reject.candidates.join("、")}`,
    );
  }
  if (errors.length > 0) reviewReasons.push("服务端规则校验未通过");

  return {
    schemaVersion: VIDEO_QC_RESULT_SCHEMA,
    ruleVersion: VIDEO_QC_RULE_VERSION,
    promptVersion: VIDEO_QC_PROMPT_VERSION,
    videoId: input.raw.task_id,
    evaluationStatus,
    dimensions: normalizedDimensions,
    rawTotalScore: unroundedTotal === null ? null : roundOne(unroundedTotal),
    finalScore,
    settlementRatio,
    analysisDurationMs: durationMs,
    invalidDurationMs,
    billableDurationMs,
    invalidSegments,
    hardVeto: input.raw.hard_reject,
    detectedTask: {
      task_id: input.raw.task_id,
      task_summary: input.raw.task_summary,
      confidence: null,
      scene_id:
        typeof input.raw.detectedTask?.scene_id === "string"
          ? input.raw.detectedTask.scene_id
          : null,
      standard_task_id:
        typeof input.raw.detectedTask?.standard_task_id === "string"
          ? input.raw.detectedTask.standard_task_id
          : null,
      variant_id:
        typeof input.raw.detectedTask?.variant_id === "string"
          ? input.raw.detectedTask.variant_id
          : null,
    },
    deductions,
    recommendations: input.raw.recommendations,
    summary: input.raw.overall_result.summary,
    reviewRequired: input.raw.review.review_required || errors.length > 0,
    reviewReasons: [...new Set(reviewReasons)],
    missingInputs: [
      ...new Set([
        ...input.sourceInput.missing_inputs,
        ...input.raw.input_status.missing_required_inputs,
      ]),
    ],
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
