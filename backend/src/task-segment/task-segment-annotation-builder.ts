import { z } from "zod";
import type { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import type { TaskSegmentAssetEntity } from "../database/entities/task-segment-asset.entity.js";
import type { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import type { AcceptedDeliveryAnnotation } from "../delivery/delivery-annotation.js";
import { rawVideoAnnotationSchema } from "../video-annotation/video-annotation.js";
import {
  canonicalSegmentJson, segmentJsonSha256, SegmentAnnotationError,
  TASK_SEGMENT_ANNOTATION_SCHEMA_VERSION, validateSegmentAnnotation,
} from "./task-segment-annotation.js";

type RecordValue = Record<string, unknown>;
export function annotationRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
const rawTask = rawVideoAnnotationSchema.shape.tasks.element;
const effectiveTaskSchema = rawTask.extend({
  effective_completion: rawTask.shape.completion.optional(),
  effective_result_status: rawTask.shape.result_status.optional(),
  effective_failure_recovery: rawTask.shape.failure_recovery.optional(),
  effective_complexity_signals: rawTask.shape.complexity_signals.optional(),
  policy_reasons: z.array(z.string()).optional(),
});
const coverageSchema = rawVideoAnnotationSchema.shape.coverage_segments.element;

/** Only this task's evidence expands the physical envelope; scene evidence never does. */
export function collectTaskSegmentEvidence(input: {
  effective: RecordValue; taskIndex: number; durationMs: number;
}): number[] {
  const tasks = input.effective.tasks;
  if (!Array.isArray(tasks) || !Number.isInteger(input.taskIndex) || input.taskIndex < 0 ||
      !annotationRecord(tasks[input.taskIndex])) {
    throw new SegmentAnnotationError("ANNOTATION_TASK_INDEX_INVALID");
  }
  const task = annotationRecord(tasks[input.taskIndex])!;
  const evidence: number[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > input.durationMs) {
      throw new SegmentAnnotationError("SEGMENT_EVIDENCE_INVALID");
    }
    evidence.push(value);
  };
  const addArray = (value: unknown) => {
    if (!Array.isArray(value)) throw new SegmentAnnotationError("SEGMENT_EVIDENCE_INVALID");
    value.forEach(add);
  };
  for (const name of ["evidence_timestamps_ms", "result_evidence_timestamps_ms",
    "failure_evidence_timestamps_ms", "recovery_evidence_timestamps_ms"]) {
    addArray(task[name]);
  }
  if (!Array.isArray(task.atomic_action_sequence)) throw new SegmentAnnotationError("SEGMENT_EVIDENCE_INVALID");
  for (const action of task.atomic_action_sequence) {
    addArray(annotationRecord(action)?.evidence_timestamps_ms);
  }
  if (!Array.isArray(input.effective.coverage_segments)) throw new SegmentAnnotationError("SEGMENT_EVIDENCE_INVALID");
  for (const value of input.effective.coverage_segments) {
    const segment = annotationRecord(value);
    if (!segment) throw new SegmentAnnotationError("SEGMENT_EVIDENCE_INVALID");
    const linked = segment.linked_task_index;
    if (linked !== null && (!Number.isInteger(linked) || Number(linked) < 0 || Number(linked) >= tasks.length)) {
      throw new SegmentAnnotationError("SEGMENT_EVIDENCE_INVALID");
    }
    if (segment.segment_type !== "task") continue;
    if (linked === null) throw new SegmentAnnotationError("SEGMENT_EVIDENCE_INVALID");
    if (linked !== input.taskIndex) continue;
    add(segment.start_ms);
    add(segment.end_ms);
    if (Number(segment.end_ms) <= Number(segment.start_ms)) throw new SegmentAnnotationError("SEGMENT_EVIDENCE_INVALID");
    addArray(segment.evidence_timestamps_ms);
  }
  return evidence;
}

export function sourceToClipTimestamp(sourceTimestampMs: number, actualStartMs: number): number {
  if (!Number.isFinite(sourceTimestampMs) || !Number.isFinite(actualStartMs)) {
    throw new SegmentAnnotationError("TIMELINE_CONVERSION_FAILED");
  }
  return sourceTimestampMs - actualStartMs;
}

export type SegmentAnnotationBuildInput = {
  asset: TaskSegmentAssetEntity;
  run: AnnotationRunEntity;
  accepted: AcceptedDeliveryAnnotation;
  sourceDurationMs: number;
  boundaryRefinementStatus: string | null;
  sourceQuality: VideoQualityResultEntity | null;
};

export function buildTaskSegmentAnnotation(input: SegmentAnnotationBuildInput, revision: number) {
  const { asset, run, accepted } = input;
  if (asset.generationStatus !== "ready") throw new SegmentAnnotationError("SEGMENT_NOT_READY");
  if (asset.validationStatus !== "passed") throw new SegmentAnnotationError("SEGMENT_MEDIA_NOT_VALIDATED");
  if (!asset.clipObjectKey || !asset.clipSha256?.match(/^[a-f0-9]{64}$/u) ||
      asset.actualStartMs === null || asset.actualEndMs === null || asset.clipDurationMs === null ||
      asset.submissionId !== run.submissionId ||
      asset.annotationRunId !== run.id) {
    throw new SegmentAnnotationError("SEGMENT_MEDIA_BINDING_INVALID");
  }
  collectTaskSegmentEvidence({ effective: accepted.effective, taskIndex: asset.taskIndex, durationMs: input.sourceDurationMs });
  const taskValue = (accepted.effective.tasks as unknown[])[asset.taskIndex];
  const taskParsed = effectiveTaskSchema.safeParse(taskValue);
  const sceneParsed = rawVideoAnnotationSchema.shape.scene.safeParse(accepted.effective.scene);
  if (!taskParsed.success || !sceneParsed.success) throw new SegmentAnnotationError("SEGMENT_JSON_SCHEMA_INVALID");
  const task = taskParsed.data;
  const scene = sceneParsed.data;
  const candidate = annotationRecord(run.normalizedResult);
  const modelSource = annotationRecord(candidate?.raw) ?? annotationRecord(candidate?.effective);
  const modelTasks = modelSource?.tasks;
  const modelTask = effectiveTaskSchema.safeParse(Array.isArray(modelTasks) ? modelTasks[asset.taskIndex] : null);
  if (!modelTask.success) throw new SegmentAnnotationError("ANNOTATION_TASK_INDEX_INVALID");

  const shift = (timestamp: number): number => {
    const shifted = sourceToClipTimestamp(timestamp, asset.actualStartMs!);
    if (shifted < 0 || shifted > asset.clipDurationMs! || timestamp > asset.actualEndMs!) {
      throw new SegmentAnnotationError("EVIDENCE_OUTSIDE_CLIP");
    }
    return shifted;
  };
  const shiftAll = (values: number[]) => values.map(shift);
  const effectiveStart = asset.refinedStartMs ?? asset.sourceStartMs;
  const effectiveEnd = asset.refinedEndMs ?? asset.sourceEndMs;
  const labelMappings = accepted.labelMappings.map(annotationRecord).filter((v): v is RecordValue => v !== null);
  // Reuse the published mappings only; do not rematch against the live dictionary.
  const lookup = (type: string, text: string | null) =>
    text === null ? undefined : labelMappings.find(m => m.type === type && m.sourceText === text.trim());
  const mapped = (type: string, text: string | null) => {
    const m = lookup(type, text);
    return m ? {
      status: m.status, label_id: m.labelId ?? null,
      label_name: m.labelName ?? null, source_text: m.sourceText ?? text,
    } : null;
  };
  const objectMapped = (text: string) => {
    const m = lookup("object", text);
    return { raw_text: text, label_id: m?.labelId ?? null, label_name: m?.labelName ?? null,
      mapping_status: m?.status ?? "unmapped" };
  };
  // accepted_unchanged is a human acceptance, not a newly verified Human Result.
  const verification = accepted.source === "human_correction" && run.humanResult !== null
    ? "human_verified" : "inherited_from_published_annotation";
  const sourceCoverage = (accepted.effective.coverage_segments as unknown[])
    .filter(value => {
      const s = annotationRecord(value);
      return s?.segment_type === "task" && s.linked_task_index === asset.taskIndex;
    }).map(value => {
      const s = coverageSchema.safeParse(value);
      if (!s.success) throw new SegmentAnnotationError("SEGMENT_EVIDENCE_INVALID");
      return {
        start_ms: shift(s.data.start_ms), end_ms: shift(s.data.end_ms), segment_type: "task",
        visible_activity: s.data.visible_activity, evidence_timestamps_ms: shiftAll(s.data.evidence_timestamps_ms),
      };
    });
  const quality = input.sourceQuality;
  const doc = {
    schema_version: TASK_SEGMENT_ANNOTATION_SCHEMA_VERSION, asset_id: asset.id, annotation_revision: revision,
    versions: {
      source_annotation_pipeline: run.pipelineVersion, source_annotation_prompt: run.promptVersion,
      source_annotation_schema: run.schemaVersion, source_evidence_policy: run.evidencePolicyVersion,
      source_auto_gate: run.autoGateVersion, boundary_refinement_policy: asset.boundaryRefinementPolicyVersion,
      materialization_policy: asset.materializationPolicyVersion,
      label_set_id: run.labelSetVersionId, label_set_revision: run.labelSetRevision,
      label_set_version: run.labelSetSnapshot?.version ?? null,
    },
    media: {
      file_name: "video.mp4", sha256: asset.clipSha256, size_bytes: Number(asset.clipSizeBytes),
      duration_ms: asset.clipDurationMs, width: asset.width, height: asset.height, frame_rate: asset.frameRate,
      codec: asset.codec, has_audio: asset.hasAudio, materialization_mode: asset.materializationMode,
      media_validation: "passed",
    },
    provenance: {
      source_submission_id: asset.submissionId, source_annotation_run_id: run.id,
      source_group_id: asset.submissionId, source_group_scope: "original_upload", source_sha256: asset.sourceSha256,
      task_index: asset.taskIndex, coarse_task_interval_ms: [asset.sourceStartMs, asset.sourceEndMs],
      refined_task_interval_ms: asset.refinedStartMs !== null || asset.refinedEndMs !== null ? [effectiveStart, effectiveEnd] : null,
      effective_task_interval_ms: [effectiveStart, effectiveEnd],
      requested_clip_interval_ms: [asset.requestedStartMs, asset.requestedEndMs],
      actual_source_interval_ms: [asset.actualStartMs, asset.actualEndMs],
    },
    timeline: {
      unit: "ms", origin: "first_video_frame", clip_duration_ms: asset.clipDurationMs,
      task_interval_ms: [shift(effectiveStart), shift(effectiveEnd)],
    },
    scene: {
      coarse_label: scene.coarse_label, fine_label: scene.fine_label, confidence: scene.confidence,
      verification, mapping: mapped("scene", scene.fine_label ?? scene.coarse_label),
    },
    task: {
      description: task.task_label, verb: task.task_verb, object: task.task_object,
      mapping: mapped("action", task.task_label), object_mapping: objectMapped(task.task_object),
      manipulated_objects: task.manipulated_objects.map(objectMapped), tools: task.tools.map(objectMapped),
      hand_mode: task.hand_mode, execution_pattern: task.execution_pattern, evidence_level: task.evidence_level,
      evidence_timestamps_ms: shiftAll(task.evidence_timestamps_ms),
      atomic_actions: task.atomic_action_sequence.map(a => ({
        order: a.order, verb: a.verb, object: a.object, evidence_timestamps_ms: shiftAll(a.evidence_timestamps_ms),
      })),
      interaction_primitives: task.interaction_primitives,
      model_completion: modelTask.data.completion,
      effective_completion: task.effective_completion ?? task.completion,
      result: {
        model_status: modelTask.data.result_status, effective_status: task.effective_result_status ?? task.result_status,
        observability: task.result_observability, evidence_type: task.result_evidence_type,
        visible_postcondition: task.visible_postcondition, evidence_timestamps_ms: shiftAll(task.result_evidence_timestamps_ms),
      },
      failure_recovery: {
        model_status: modelTask.data.failure_recovery, effective_status: task.effective_failure_recovery ?? task.failure_recovery,
        failure_evidence_timestamps_ms: shiftAll(task.failure_evidence_timestamps_ms),
        recovery_evidence_timestamps_ms: shiftAll(task.recovery_evidence_timestamps_ms),
      },
      complexity_signals: task.effective_complexity_signals ?? task.complexity_signals,
      uncertainty_reasons: task.uncertainty_reasons, confidence: task.confidence,
    },
    coverage_segments: sourceCoverage,
    verification: {
      source_annotation_acceptance: accepted.acceptance.mode,
      source_annotation_review_revision: run.reviewRevision, source_auto_gate_version: run.autoGateVersion,
      semantic_verification: verification, boundary_source: asset.boundarySource,
      boundary_refinement_status: input.boundaryRefinementStatus, media_validation: "passed",
      // Do not copy unrestricted provider errors or internal notes into the artifact.
      warnings: [verification === "human_verified" ? "SOURCE_HUMAN_RESULT" : "SEMANTICS_INHERITED_NOT_CLIP_VERIFIED"],
    },
    source_video_quality: quality ? {
      scope: "source_video", status: quality.status, final_score: quality.finalScore === null ? null : Number(quality.finalScore),
      rule_version: quality.qualityRuleSnapshot?.version ?? quality.qualityRuleVersionId,
    } : null,
  };
  return validateSegmentAnnotation(doc, { assetId: asset.id, revision, videoSha256: asset.clipSha256 });
}

export function taskSegmentSourceFingerprint(input: SegmentAnnotationBuildInput): string {
  const document = buildTaskSegmentAnnotation(input, 1);
  const task = (input.accepted.effective.tasks as RecordValue[])[input.asset.taskIndex]!;
  const objectTexts = [task.task_object, ...(task.manipulated_objects as string[]), ...(task.tools as string[])];
  const relevantMappings = input.accepted.labelMappings.filter(value => {
    const m = annotationRecord(value);
    if (!m) return false;
    return (m.type === "scene" && [document.scene.coarse_label, document.scene.fine_label].includes(m.sourceText as string)) ||
      (m.type === "action" && m.sourceText === document.task.description.trim()) ||
      (m.type === "object" && objectTexts.some(text => typeof text === "string" && text.trim() === m.sourceText));
  });
  return segmentJsonSha256(canonicalSegmentJson({
    document,
    effective_task: task,
    source_scene: input.accepted.effective.scene,
    label_mappings: relevantMappings,
    clip_object_key: input.asset.clipObjectKey,
    source_prompt_sha256: input.run.promptContentSha256,
    source_review_status: input.run.reviewStatus,
    generation_policy_version: input.asset.generationPolicyVersion,
  }));
}
