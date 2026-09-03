import { AnnotationRunEntity } from "../../src/database/entities/annotation-run.entity.js";
import { TaskSegmentAssetEntity } from "../../src/database/entities/task-segment-asset.entity.js";
import { acceptedAnnotationRun } from "../../src/delivery/delivery-annotation.js";
import { segmentJsonSha256 } from "../../src/task-segment/task-segment-annotation.js";
import type { SegmentAnnotationBuildInput } from "../../src/task-segment/task-segment-annotation-builder.js";

export function segmentAnnotationFixture(suffix = "1"): SegmentAnnotationBuildInput {
  const task = {
    start_ms: 40000, end_ms: 50000, task_label: "清洗杯子", task_verb: "wash_or_rinse",
    task_object: "杯子", evidence_level: "direct_visual", execution_pattern: "single_goal",
    evidence_timestamps_ms: [42000, 48000], manipulated_objects: ["杯子"], tools: ["海绵"],
    hand_mode: "both", atomic_action_sequence: [
      { order: 1, verb: "grasp", object: "杯子", evidence_timestamps_ms: [42000] },
      { order: 2, verb: "rub_or_wipe", object: "杯子", evidence_timestamps_ms: [48000] },
    ],
    interaction_primitives: ["grasp", "rub_or_wipe"], completion: "complete",
    result_observability: "visible", result_status: "success",
    result_evidence_type: "direct_visible_postcondition", visible_postcondition: "杯子清洁",
    result_evidence_timestamps_ms: [50000], failure_recovery: "none_observed",
    failure_evidence_timestamps_ms: [], recovery_evidence_timestamps_ms: [],
    complexity_signals: ["tool_use"], uncertainty_reasons: [], confidence: 0.9,
  };
  const raw = {
    schema_version: "ego_video_annotation_v2", video_id: `SUB-JSON-${suffix}`, video_summary: "清洗",
    scene: { coarse_label: "室内", fine_label: "家庭厨房", confidence: 0.9, evidence_timestamps_ms: [0] },
    temporal_structure_type: "single_task", model_assessability: "assessable", assessability_reason: "可见",
    tasks: [task], coverage_segments: [{
      start_ms: 40000, end_ms: 50000, segment_type: "task", linked_task_index: 0,
      visible_activity: "清洗杯子", evidence_timestamps_ms: [42000],
    }], uncertain_fields: [], global_limitations: [],
  };
  const run = Object.assign(new AnnotationRunEntity(), {
    id: `RUN-JSON-${suffix}`, submissionId: raw.video_id,
    pipelineVersion: "ego_video_annotation_pipeline_v2", schemaVersion: "ego_video_annotation_v2",
    evidencePolicyVersion: "ego_annotation_evidence_policy_v3", promptVersion: "ego_video_annotation_prompt_v2",
    promptContentSha256: "a".repeat(64), systemPromptSnapshot: "test prompt", outputExampleSnapshot: {},
    model: "test-model", executionStatus: "succeeded", reviewStatus: "not_required", publicationStatus: "auto_accepted",
    autoEligibility: "eligible", autoGateVersion: "annotation_auto_gate_v2",
    wouldAutoAccept: true, autoAcceptEnabledSnapshot: true, autoGateEvaluatedAt: new Date(),
    queuedAt: new Date(), startedAt: new Date(), completedAt: new Date(),
    normalizedResult: {
      schemaVersion: "ego_video_annotation_v2", policyVersion: "ego_annotation_evidence_policy_v3",
      promptVersion: "ego_video_annotation_prompt_v2", promptContentSha256: "a".repeat(64), model: "test-model",
      raw: structuredClone(raw), effective: structuredClone(raw),
      validation: { errors: [], warnings: [] },
      labelMappings: [
        { type: "scene", sourceText: "家庭厨房", status: "matched", labelId: "SCENE-001", labelName: "家庭厨房", confidence: 0.9 },
        { type: "action", sourceText: "清洗杯子", status: "proposed", labelId: null, labelName: null, confidence: 0.9 },
        { type: "object", sourceText: "杯子", status: "matched", labelId: "OBJ-CUP", labelName: "杯子", confidence: 0.9 },
      ],
    },
  });
  const asset = Object.assign(new TaskSegmentAssetEntity(), {
    id: `TSA-JSON-${suffix}`, submissionId: run.submissionId, annotationRunId: run.id, taskIndex: 0,
    pipelineVersion: run.pipelineVersion, promptVersion: run.promptVersion, schemaVersion: run.schemaVersion,
    evidencePolicyVersion: run.evidencePolicyVersion, taskLabel: task.task_label, taskVerb: task.task_verb,
    completion: "complete", resultStatus: "success", sourceStartMs: 40000, sourceEndMs: 50000,
    requestedStartMs: 39500, requestedEndMs: 50500, actualStartMs: 39500, actualEndMs: 50500,
    clipStartMs: 39500, clipEndMs: 50500, clipDurationMs: 11000, clipSizeBytes: "4",
    clipSha256: segmentJsonSha256("clip"), clipObjectKey: `segments/TSA-JSON-${suffix}/video.mp4`,
    sourceObjectKey: `uploads/SUB-JSON-${suffix}.mp4`, sourceSha256: segmentJsonSha256("source"),
    codec: "h264", width: 320, height: 180, frameRate: 30, hasAudio: true,
    generationStatus: "ready", validationStatus: "passed", coverageSnapshot: [], evidenceSnapshot: {},
    materializationMode: "exact_clip_transcode", materializationPolicyVersion: "task_segment_adaptive_cut_policy_v1",
    generationPolicyVersion: "task_segment_v1_policy_v2", storageLayoutVersion: "task_segment_asset_layout_v1",
    sourceDurationMs: 60000, startedAt: new Date(), completedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  });
  return { asset, run, accepted: acceptedAnnotationRun(run, null)!, sourceDurationMs: 60000,
    boundaryRefinementStatus: null, sourceQuality: null };
}
