import { z } from "zod";

import type { TimestampedFrame } from "../video-quality/video-quality.types.js";

export const VIDEO_ANNOTATION_SCHEMA_VERSION = "ego_video_annotation_v1" as const;
export const VIDEO_ANNOTATION_POLICY_VERSION =
  "ego_annotation_evidence_policy_v1" as const;

export const TASK_VERBS = [
  "pick_and_place",
  "move",
  "carry",
  "place",
  "open",
  "close",
  "cut",
  "pour",
  "press",
  "twist",
  "spray",
  "insert",
  "remove",
  "assemble",
  "disassemble",
  "fold",
  "unfold",
  "squeeze",
  "adjust",
  "rub_or_wipe",
  "wash_or_rinse",
  "organize",
  "other_visible_task",
  "uncertain",
] as const;

export const INTERACTION_PRIMITIVES = [
  "grasp",
  "pinch",
  "hold",
  "support",
  "place",
  "push",
  "pull",
  "press",
  "twist",
  "insert",
  "remove",
  "cut",
  "pour",
  "rub_or_wipe",
  "other",
] as const;

const boundedConfidence = z.number().finite().min(0).max(1);
const nonNegativeTime = z.number().finite().nonnegative();

const rawTaskSchema = z
  .object({
    start_ms: nonNegativeTime,
    end_ms: nonNegativeTime,
    task_label: z.string().min(1).max(200),
    task_verb: z.enum(TASK_VERBS),
    task_object: z.string().max(200),
    evidence_level: z.enum([
      "direct_visual",
      "partially_inferred",
      "uncertain",
    ]),
    evidence_timestamps_ms: z.array(nonNegativeTime).max(20),
    manipulated_objects: z.array(z.string().min(1).max(120)).max(30),
    tools: z.array(z.string().min(1).max(120)).max(20),
    hand_mode: z.enum([
      "left",
      "right",
      "both",
      "unclear",
      "no_hand_visible",
    ]),
    interaction_primitives: z.array(z.enum(INTERACTION_PRIMITIVES)).max(20),
    completion: z.enum(["complete", "incomplete", "partial", "uncertain"]),
    result_observability: z.enum(["visible", "partial", "not_visible"]),
    result_status: z.enum([
      "success",
      "failure",
      "partial",
      "not_applicable",
      "unknown",
    ]),
    visible_postcondition: z.string().max(500),
    result_evidence_timestamps_ms: z.array(nonNegativeTime).max(20),
    failure_recovery: z.enum([
      "none_observed",
      "failure_without_recovery",
      "failure_then_recovery",
      "ambiguous",
      "not_assessable",
    ]),
    uncertainty_reasons: z.array(z.string().min(1).max(500)).max(20),
    confidence: boundedConfidence,
  })
  .strict();

export const rawVideoAnnotationSchema = z
  .object({
    schema_version: z.literal(VIDEO_ANNOTATION_SCHEMA_VERSION),
    video_id: z.string().min(1).max(128),
    video_summary: z.string().max(2_000),
    scene: z
      .object({
        coarse_label: z.string().max(120).nullable(),
        fine_label: z.string().max(200).nullable(),
        confidence: boundedConfidence,
        evidence_timestamps_ms: z.array(nonNegativeTime).max(20),
      })
      .strict(),
    temporal_structure_type: z.enum([
      "single_task",
      "multiple_tasks",
      "continuous_repetitive",
      "unclear",
    ]),
    tasks: z.array(rawTaskSchema).max(100),
    global_limitations: z.array(z.string().min(1).max(500)).max(30),
  })
  .strict();

export type RawVideoAnnotation = z.infer<typeof rawVideoAnnotationSchema>;
export type RawVideoAnnotationTask = RawVideoAnnotation["tasks"][number];

export type EffectiveVideoAnnotationTask = RawVideoAnnotationTask & {
  effective_completion: RawVideoAnnotationTask["completion"];
  effective_result_status: RawVideoAnnotationTask["result_status"];
  effective_failure_recovery: RawVideoAnnotationTask["failure_recovery"];
  policy_reasons: string[];
};

export type VideoAnnotationLabelMapping = {
  type: "scene" | "action" | "object";
  sourceText: string;
  status: "matched" | "proposed";
  labelId: string | null;
  labelName: string | null;
  confidence: number;
};

export type VideoAnnotationCandidateSuccess = {
  status: "candidate" | "review_required";
  schemaVersion: typeof VIDEO_ANNOTATION_SCHEMA_VERSION;
  policyVersion: typeof VIDEO_ANNOTATION_POLICY_VERSION;
  promptVersion: string;
  promptContentSha256: string;
  model: string;
  requestId: string | null;
  durationMs: number;
  frameCount: number;
  sampling: {
    maxFrameGapMs: number | null;
    sourceTimestampsMs: number[];
  };
  labelMappings: VideoAnnotationLabelMapping[];
  raw: RawVideoAnnotation;
  effective: Omit<RawVideoAnnotation, "tasks"> & {
    tasks: EffectiveVideoAnnotationTask[];
  };
  validation: {
    errors: string[];
    warnings: string[];
  };
  reviewReasons: string[];
};

export type VideoAnnotationCandidateFailure = {
  status: "system_failed";
  schemaVersion: typeof VIDEO_ANNOTATION_SCHEMA_VERSION;
  policyVersion: typeof VIDEO_ANNOTATION_POLICY_VERSION;
  promptVersion: string;
  promptContentSha256: string;
  model: string;
  error: string;
};

export type VideoAnnotationCandidate =
  | VideoAnnotationCandidateSuccess
  | VideoAnnotationCandidateFailure;

function maxFrameGapMs(frames: TimestampedFrame[]): number | null {
  if (frames.length < 2) return null;
  const timestamps = frames
    .map((frame) => frame.timestampMs)
    .sort((left, right) => left - right);
  let maximum = 0;
  for (let index = 1; index < timestamps.length; index += 1) {
    maximum = Math.max(maximum, timestamps[index]! - timestamps[index - 1]!);
  }
  return maximum;
}

function timestampHasSourceEvidence(
  timestampMs: number,
  sourceTimestamps: Set<number>,
): boolean {
  return sourceTimestamps.has(timestampMs);
}

export function normalizeVideoAnnotation(input: {
  raw: RawVideoAnnotation;
  frames: TimestampedFrame[];
  durationMs: number;
  promptVersion: string;
  promptContentSha256: string;
  model: string;
  requestId: string | null;
  modelDurationMs: number;
  enabledLabels?: Array<{
    id: string;
    name: string;
    type: "scene" | "action" | "object";
  }>;
}): VideoAnnotationCandidateSuccess {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reviewReasons: string[] = [];
  const sourceTimestamps = new Set(
    input.frames.map((frame) => frame.timestampMs),
  );
  const gapMs = maxFrameGapMs(input.frames);

  if (input.raw.video_id !== input.raw.video_id.trim()) {
    errors.push("video_id 包含首尾空白");
  }

  const effectiveTasks = input.raw.tasks.map((task, taskIndex) => {
    const reasons: string[] = [];
    const context = `tasks[${taskIndex}]`;
    if (task.end_ms <= task.start_ms) {
      errors.push(`${context} 时间区间无效`);
    }
    if (task.end_ms > input.durationMs) {
      errors.push(`${context} 结束时间超出视频时长`);
    }
    for (const timestamp of task.evidence_timestamps_ms) {
      if (timestamp < task.start_ms || timestamp > task.end_ms) {
        errors.push(`${context} 的任务证据不在任务区间内`);
      }
      if (!timestampHasSourceEvidence(timestamp, sourceTimestamps)) {
        errors.push(`${context} 引用了未提供的任务证据时间点 ${timestamp}`);
      }
    }
    for (const timestamp of task.result_evidence_timestamps_ms) {
      if (timestamp < task.start_ms || timestamp > task.end_ms) {
        errors.push(`${context} 的结果证据不在任务区间内`);
      }
      if (!timestampHasSourceEvidence(timestamp, sourceTimestamps)) {
        errors.push(`${context} 引用了未提供的结果证据时间点 ${timestamp}`);
      }
    }
    if (task.evidence_timestamps_ms.length === 0) {
      reasons.push("task_missing_source_evidence");
    }
    if (
      task.evidence_level === "direct_visual" &&
      task.evidence_timestamps_ms.length < 2
    ) {
      reasons.push("direct_visual_requires_multiple_frames");
    }

    let effectiveCompletion = task.completion;
    let effectiveResult = task.result_status;
    let effectiveRecovery = task.failure_recovery;
    if (gapMs !== null && gapMs > 1_000) {
      if (task.completion !== "uncertain") {
        effectiveCompletion = "uncertain";
        reasons.push("sparse_sampling_cannot_verify_completion");
      }
      if (
        task.result_status !== "unknown" &&
        task.result_status !== "not_applicable"
      ) {
        effectiveResult = "unknown";
        reasons.push("sparse_sampling_cannot_verify_outcome");
      }
      if (task.failure_recovery !== "not_assessable") {
        effectiveRecovery = "not_assessable";
        reasons.push("sparse_sampling_cannot_verify_failure_recovery");
      }
    }
    if (
      task.result_observability !== "visible" ||
      task.result_evidence_timestamps_ms.length === 0
    ) {
      if (
        effectiveResult !== "unknown" &&
        effectiveResult !== "not_applicable"
      ) {
        effectiveResult = "unknown";
      }
      reasons.push("result_lacks_direct_postcondition_evidence");
    }
    if (task.evidence_level === "uncertain" || task.confidence < 0.75) {
      reasons.push("semantic_annotation_low_confidence");
    }
    if (reasons.length > 0) {
      reviewReasons.push(`${context}: ${reasons.join(",")}`);
    }
    return {
      ...task,
      effective_completion: effectiveCompletion,
      effective_result_status: effectiveResult,
      effective_failure_recovery: effectiveRecovery,
      policy_reasons: [...new Set(reasons)],
    };
  });

  for (const timestamp of input.raw.scene.evidence_timestamps_ms) {
    if (!timestampHasSourceEvidence(timestamp, sourceTimestamps)) {
      errors.push(`scene 引用了未提供的证据时间点 ${timestamp}`);
    }
  }
  if (input.raw.scene.confidence < 0.75) {
    reviewReasons.push("scene: low_confidence");
  }
  if (input.raw.tasks.length === 0) {
    reviewReasons.push("未识别到可见任务");
  }
  if (gapMs !== null && gapMs > 1_000) {
    warnings.push(
      `最大采样间隔 ${gapMs}ms，完成度、结果和失败恢复已按证据策略保守降级`,
    );
  }
  if (errors.length > 0) {
    reviewReasons.push("候选标注证据校验未通过");
  }

  const labelMappings = mapControlledLabels(
    input.raw,
    input.enabledLabels ?? [],
  );

  return {
    status:
      errors.length > 0 || reviewReasons.length > 0
        ? "review_required"
        : "candidate",
    schemaVersion: VIDEO_ANNOTATION_SCHEMA_VERSION,
    policyVersion: VIDEO_ANNOTATION_POLICY_VERSION,
    promptVersion: input.promptVersion,
    promptContentSha256: input.promptContentSha256,
    model: input.model,
    requestId: input.requestId,
    durationMs: input.modelDurationMs,
    frameCount: input.frames.length,
    sampling: {
      maxFrameGapMs: gapMs,
      sourceTimestampsMs: input.frames.map((frame) => frame.timestampMs),
    },
    labelMappings,
    raw: input.raw,
    effective: {
      ...input.raw,
      tasks: effectiveTasks,
    },
    validation: { errors, warnings },
    reviewReasons: [...new Set(reviewReasons)],
  };
}

function normalizedLabelName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function mapControlledLabels(
  raw: RawVideoAnnotation,
  enabledLabels: Array<{
    id: string;
    name: string;
    type: "scene" | "action" | "object";
  }>,
): VideoAnnotationLabelMapping[] {
  const indexes = new Map<
    string,
    { id: string; name: string; type: "scene" | "action" | "object" }
  >();
  for (const label of enabledLabels) {
    indexes.set(`${label.type}:${normalizedLabelName(label.name)}`, label);
  }
  const sources: Array<{
    type: "scene" | "action" | "object";
    text: string;
    confidence: number;
  }> = [];
  const sceneText = raw.scene.fine_label ?? raw.scene.coarse_label;
  if (sceneText) {
    sources.push({
      type: "scene",
      text: sceneText,
      confidence: raw.scene.confidence,
    });
  }
  for (const task of raw.tasks) {
    sources.push({
      type: "action",
      text: task.task_label,
      confidence: task.confidence,
    });
    for (const object of [task.task_object, ...task.manipulated_objects]) {
      if (object.trim()) {
        sources.push({ type: "object", text: object, confidence: task.confidence });
      }
    }
  }

  const seen = new Set<string>();
  return sources.flatMap((source) => {
    const sourceText = source.text.trim();
    const sourceKey = `${source.type}:${normalizedLabelName(sourceText)}`;
    if (seen.has(sourceKey)) return [];
    seen.add(sourceKey);
    const matched = indexes.get(sourceKey);
    return [
      {
        type: source.type,
        sourceText,
        status: matched ? ("matched" as const) : ("proposed" as const),
        labelId: matched?.id ?? null,
        labelName: matched?.name ?? null,
        confidence: source.confidence,
      },
    ];
  });
}

export function parseRawVideoAnnotation(value: unknown): RawVideoAnnotation {
  return rawVideoAnnotationSchema.parse(value);
}
