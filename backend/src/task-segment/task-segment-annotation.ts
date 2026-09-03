import { createHash } from "node:crypto";
import { z } from "zod";
import { TASK_VERBS, ATOMIC_ACTION_VERBS, INTERACTION_PRIMITIVES, EXECUTION_PATTERNS, COMPLEXITY_SIGNALS } from "../video-annotation/video-annotation.js";

export const TASK_SEGMENT_ANNOTATION_SCHEMA_VERSION = "task_segment.v1" as const;
export const TASK_SEGMENT_STORAGE_LAYOUT_VERSION = "task_segment_asset_layout_v1";
export const TASK_SEGMENT_EVIDENCE_POLICY_VERSION = "task_segment_v1_policy_v2";

export function taskSegmentVideoObjectKey(assetId: string): string {
  return `segments/${assetId}/video.mp4`;
}
export function taskSegmentAnnotationObjectKey(assetId: string, revision: number): string {
  return `segments/${assetId}/annotation.r${String(revision).padStart(4, "0")}.json`;
}

// Error text is deliberately a fixed code, never a provider/storage exception,
// source content, URL, credential or local filename.
export class SegmentAnnotationError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); }
}

export function canonicalSegmentJson(value: unknown): string {
  function ordered(input: unknown): unknown {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (Array.isArray(input)) return input.map(ordered);
    if (typeof input === "object" && Object.getPrototypeOf(input) === Object.prototype) {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, ordered(item)]));
    }
    throw new SegmentAnnotationError("SEGMENT_JSON_SERIALIZATION_FAILED");
  }
  return JSON.stringify(ordered(value), null, 2) + "\n";
}
export function segmentJsonSha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const time = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const integer = z.number().int().nonnegative();
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const interval = z.tuple([time, time]).refine(([a, b]) => b > a, "Invalid interval");
const confidence = z.number().finite().min(0).max(1);
const mapping = z.object({
  status: z.enum(["matched", "proposed"]),
  label_id: z.string().nullable(),
  label_name: z.string().nullable(),
  source_text: z.string().nullable(),
}).strict().refine(v => v.status === "matched" ? Boolean(v.label_id && v.label_name) : v.label_id === null, "Invalid label mapping");
const objectMapping = z.object({
  raw_text: z.string(),
  label_id: z.string().nullable(),
  label_name: z.string().nullable(),
  mapping_status: z.enum(["matched", "proposed", "unmapped"]),
}).strict().refine(v => v.mapping_status === "matched" ? Boolean(v.label_id && v.label_name) : v.label_id === null, "Invalid object mapping");
const completion = z.enum(["complete", "incomplete", "partial", "uncertain"]);
const resultStatus = z.enum(["success", "failure", "partial", "not_applicable", "unknown"]);
const recovery = z.enum(["none_observed", "failure_without_recovery", "failure_then_recovery", "possible_failure", "ambiguous", "not_assessable"]);
const semanticVerification = z.enum(["inherited_from_published_annotation", "human_verified"]);

export const taskSegmentAnnotationSchema = z.object({
  schema_version: z.literal(TASK_SEGMENT_ANNOTATION_SCHEMA_VERSION),
  asset_id: z.string().min(1),
  annotation_revision: z.number().int().positive(),
  versions: z.object({
    source_annotation_pipeline: z.string().min(1),
    source_annotation_prompt: z.string().min(1),
    source_annotation_schema: z.string().min(1),
    source_evidence_policy: z.string().min(1),
    source_auto_gate: z.string().nullable(),
    boundary_refinement_policy: z.string().nullable(),
    materialization_policy: z.string().min(1),
    label_set_id: z.string().nullable(),
    label_set_revision: integer.nullable(),
    label_set_version: z.string().nullable(),
  }).strict(),
  media: z.object({
    file_name: z.literal("video.mp4"), sha256: sha,
    size_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    duration_ms: positive, width: z.number().int().positive(), height: z.number().int().positive(),
    frame_rate: positive, codec: z.string().min(1), has_audio: z.boolean(),
    materialization_mode: z.enum(["stream_copy", "exact_clip_transcode"]),
    media_validation: z.literal("passed"),
  }).strict(),
  provenance: z.object({
    source_submission_id: z.string().min(1), source_annotation_run_id: z.string().min(1),
    source_group_id: z.string().min(1), source_group_scope: z.literal("original_upload"),
    source_sha256: sha, task_index: integer,
    coarse_task_interval_ms: interval, refined_task_interval_ms: interval.nullable(),
    effective_task_interval_ms: interval, requested_clip_interval_ms: interval,
    actual_source_interval_ms: interval,
  }).strict(),
  timeline: z.object({
    unit: z.literal("ms"), origin: z.literal("first_video_frame"),
    clip_duration_ms: positive, task_interval_ms: interval,
  }).strict(),
  scene: z.object({
    coarse_label: z.string().nullable(), fine_label: z.string().nullable(), confidence,
    verification: semanticVerification, mapping: mapping.nullable(),
  }).strict(),
  task: z.object({
    description: z.string().min(1), verb: z.enum(TASK_VERBS), object: z.string(),
    mapping: mapping.nullable(), object_mapping: objectMapping,
    manipulated_objects: z.array(objectMapping), tools: z.array(objectMapping),
    hand_mode: z.enum(["left", "right", "both", "unclear", "no_hand_visible"]),
    execution_pattern: z.enum(EXECUTION_PATTERNS),
    evidence_level: z.enum(["direct_visual", "partially_inferred", "uncertain"]),
    evidence_timestamps_ms: z.array(time),
    atomic_actions: z.array(z.object({
      order: z.number().int().positive(), verb: z.enum(ATOMIC_ACTION_VERBS),
      object: z.string(), evidence_timestamps_ms: z.array(time),
    }).strict()),
    interaction_primitives: z.array(z.enum(INTERACTION_PRIMITIVES)),
    model_completion: completion, effective_completion: completion,
    result: z.object({
      model_status: resultStatus, effective_status: resultStatus,
      observability: z.enum(["visible", "partial", "not_visible"]),
      evidence_type: z.enum(["direct_visible_postcondition", "action_completion_only", "contextual_inference", "not_observed"]),
      visible_postcondition: z.string(), evidence_timestamps_ms: z.array(time),
    }).strict(),
    failure_recovery: z.object({
      model_status: recovery, effective_status: recovery,
      failure_evidence_timestamps_ms: z.array(time),
      recovery_evidence_timestamps_ms: z.array(time),
    }).strict(),
    complexity_signals: z.array(z.enum(COMPLEXITY_SIGNALS)),
    uncertainty_reasons: z.array(z.string()), confidence,
  }).strict(),
  coverage_segments: z.array(z.object({
    start_ms: time, end_ms: time, segment_type: z.literal("task"),
    visible_activity: z.string(), evidence_timestamps_ms: z.array(time),
  }).strict()),
  verification: z.object({
    source_annotation_acceptance: z.enum(["automatic", "human"]),
    source_annotation_review_revision: integer, source_auto_gate_version: z.string().nullable(),
    semantic_verification: semanticVerification,
    boundary_source: z.enum(["coarse", "refined", "coarse_fallback"]),
    boundary_refinement_status: z.string().nullable(),
    media_validation: z.literal("passed"), warnings: z.array(z.string()),
  }).strict(),
  source_video_quality: z.object({
    scope: z.literal("source_video"), status: z.string(),
    final_score: z.number().finite().nullable(), rule_version: z.string().nullable(),
  }).strict().nullable(),
}).strict().superRefine((doc, ctx) => {
  const duration = doc.timeline.clip_duration_ms;
  if (duration !== doc.media.duration_ms) ctx.addIssue({ code: "custom", message: "Duration mismatch" });
  if (doc.provenance.source_group_id !== doc.provenance.source_submission_id) ctx.addIssue({ code: "custom", message: "Invalid original upload group" });
  const timestamps = [
    ...doc.timeline.task_interval_ms, ...doc.task.evidence_timestamps_ms,
    ...doc.task.result.evidence_timestamps_ms,
    ...doc.task.failure_recovery.failure_evidence_timestamps_ms,
    ...doc.task.failure_recovery.recovery_evidence_timestamps_ms,
    ...doc.task.atomic_actions.flatMap(a => a.evidence_timestamps_ms),
    ...doc.coverage_segments.flatMap(s => [s.start_ms, s.end_ms, ...s.evidence_timestamps_ms]),
  ];
  if (timestamps.some(t => t > duration)) ctx.addIssue({ code: "custom", message: "Evidence outside clip" });
  if (doc.coverage_segments.some(s => s.end_ms <= s.start_ms)) ctx.addIssue({ code: "custom", message: "Invalid coverage interval" });
  if (doc.task.atomic_actions.some((a, i, all) => i > 0 && a.order <= all[i - 1]!.order)) ctx.addIssue({ code: "custom", message: "Invalid action order" });
});
export type TaskSegmentAnnotationV1 = z.infer<typeof taskSegmentAnnotationSchema>;

export function validateSegmentAnnotation(value: unknown, binding: {
  assetId: string; revision: number; videoSha256: string;
}): TaskSegmentAnnotationV1 {
  const parsed = taskSegmentAnnotationSchema.safeParse(value);
  if (!parsed.success) throw new SegmentAnnotationError("SEGMENT_JSON_SCHEMA_INVALID");
  if (parsed.data.asset_id !== binding.assetId || parsed.data.annotation_revision !== binding.revision ||
      parsed.data.media.sha256 !== binding.videoSha256) {
    throw new SegmentAnnotationError("SEGMENT_MEDIA_BINDING_INVALID");
  }
  return parsed.data;
}
