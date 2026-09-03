import type { TaskSegmentAssetProjectionEntity } from "../database/entities/task-segment-asset-projection.entity.js";

export type TaskAssetSearchRow = TaskSegmentAssetProjectionEntity & {
  annotationRevision: number; isCurrent: boolean; durationMs: number; width: number; height: number;
  frameRate: number; hasAudio: boolean; materializationMode: string; sizeBytes: number;
  assetCreatedAt: Date; publishedAt: Date | null;
};

// Explicit whitelist: never select source JSON, prompts, storage keys or people.
export const TASK_ASSET_SELECT = `
  p.asset_id AS "assetId",
  p.current_annotation_revision_id AS "currentAnnotationRevisionId",
  p.projection_version AS "projectionVersion",
  p.source_group_id AS "sourceGroupId",
  p.scene_group_key AS "sceneGroupKey",
  p.scene_mapping_status AS "sceneMappingStatus",
  p.primary_scene_id AS "primarySceneId",
  p.primary_scene_name AS "primarySceneName",
  p.scene_coarse_label AS "sceneCoarseLabel",
  p.scene_fine_label AS "sceneFineLabel",
  p.scene_verification AS "sceneVerification",
  p.task_description AS "taskDescription",
  p.task_verb AS "taskVerb",
  p.task_mapping_status AS "taskMappingStatus",
  p.task_label_id AS "taskLabelId",
  p.task_label_name AS "taskLabelName",
  p.task_object_raw AS "taskObjectRaw",
  p.object_label_ids AS "objectLabelIds",
  p.object_label_names AS "objectLabelNames",
  p.object_raw_texts AS "objectRawTexts",
  p.tool_label_ids AS "toolLabelIds",
  p.tool_label_names AS "toolLabelNames",
  p.tool_raw_texts AS "toolRawTexts",
  p.interaction_primitives AS "interactionPrimitives",
  p.complexity_signals AS "complexitySignals",
  p.proposed_object_count AS "proposedObjectCount",
  p.unmapped_object_count AS "unmappedObjectCount",
  p.proposed_tool_count AS "proposedToolCount",
  p.unmapped_tool_count AS "unmappedToolCount",
  p.warning_count AS "warningCount",
  p.hand_mode AS "handMode",
  p.execution_pattern AS "executionPattern",
  p.evidence_level AS "evidenceLevel",
  p.model_completion AS "modelCompletion",
  p.effective_completion AS "effectiveCompletion",
  p.model_result_status AS "modelResultStatus",
  p.effective_result_status AS "effectiveResultStatus",
  p.effective_failure_recovery AS "effectiveFailureRecovery",
  p.semantic_verification AS "semanticVerification",
  p.source_annotation_acceptance AS "sourceAnnotationAcceptance",
  p.boundary_source AS "boundarySource",
  p.search_text AS "searchText",
  p.has_uncertainty AS "hasUncertainty",
  p.has_unmapped_labels AS "hasUnmappedLabels",
  p.object_labels AS "objectLabels",
  p.tool_labels AS "toolLabels",
  r.revision AS "annotationRevision",
  ar.publication_status IN ('auto_accepted', 'human_verified') AS "isCurrent",
  a.clip_duration_ms AS "durationMs", a.width, a.height, a.frame_rate AS "frameRate",
  a.has_audio AS "hasAudio", a.materialization_mode AS "materializationMode",
  a.clip_size_bytes::float8 AS "sizeBytes", a.created_at AS "assetCreatedAt", r.published_at AS "publishedAt"
`;

export const TASK_ASSET_TOTALS = `
  count(*)::int AS "assetCount",
  COALESCE(sum("durationMs"), 0)::float8 AS "totalSegmentDurationMs",
  COALESCE(sum("sizeBytes"), 0)::float8 AS "totalStorageBytes",
  count(DISTINCT "sourceGroupId")::int AS "sourceGroupCount"`;

export const TASK_ASSET_VERIFICATION_COUNTS = `
  count(*) FILTER (WHERE "semanticVerification" = 'human_verified')::int AS "humanVerifiedCount",
  count(*) FILTER (WHERE "semanticVerification" = 'inherited_from_published_annotation')::int AS "inheritedCount",
  count(*) FILTER (WHERE "hasUnmappedLabels")::int AS "unmappedLabelAssetCount",
  count(*) FILTER (WHERE "hasUncertainty")::int AS "uncertainAssetCount"`;

export const TASK_ASSET_SUMMARY = `${TASK_ASSET_TOTALS}, ${TASK_ASSET_VERIFICATION_COUNTS},
  count(*) FILTER (WHERE "sceneMappingStatus" = 'matched')::int AS "mappedSceneCount",
  count(*) FILTER (WHERE "sceneMappingStatus" = 'proposed')::int AS "proposedSceneCount",
  count(*) FILTER (WHERE "sceneMappingStatus" = 'unknown')::int AS "unknownSceneCount"`;

export type TaskAssetSummary = {
  assetCount: number; totalSegmentDurationMs: number; totalStorageBytes: number; sourceGroupCount: number;
  humanVerifiedCount: number; inheritedCount: number; mappedSceneCount: number; proposedSceneCount: number;
  unknownSceneCount: number; unmappedLabelAssetCount: number; uncertainAssetCount: number;
};

export function taskAssetItem(row: TaskAssetSearchRow) {
  return {
    assetId: row.assetId, currentAnnotationRevisionId: row.currentAnnotationRevisionId,
    annotationRevision: row.annotationRevision, isCurrent: row.isCurrent,
    scene: { groupKey: row.sceneGroupKey, mappingStatus: row.sceneMappingStatus, id: row.primarySceneId,
      name: row.primarySceneName, coarseLabel: row.sceneCoarseLabel, fineLabel: row.sceneFineLabel, verification: row.sceneVerification },
    task: { description: row.taskDescription, verb: row.taskVerb, labelId: row.taskLabelId,
      labelName: row.taskLabelName, mappingStatus: row.taskMappingStatus },
    objects: { ids: row.objectLabelIds, names: row.objectLabelNames, rawTexts: row.objectRawTexts,
      unmappedCount: row.unmappedObjectCount, proposedCount: row.proposedObjectCount },
    tools: { ids: row.toolLabelIds, names: row.toolLabelNames, rawTexts: row.toolRawTexts,
      unmappedCount: row.unmappedToolCount, proposedCount: row.proposedToolCount },
    handMode: row.handMode, executionPattern: row.executionPattern, interactionPrimitives: row.interactionPrimitives,
    complexitySignals: row.complexitySignals, completion: row.effectiveCompletion, resultStatus: row.effectiveResultStatus,
    failureRecovery: row.effectiveFailureRecovery, semanticVerification: row.semanticVerification,
    sourceAnnotationAcceptance: row.sourceAnnotationAcceptance, boundarySource: row.boundarySource,
    media: { durationMs: row.durationMs, width: row.width, height: row.height, frameRate: row.frameRate,
      hasAudio: row.hasAudio, materializationMode: row.materializationMode, sizeBytes: row.sizeBytes },
    sourceGroupId: row.sourceGroupId, hasUncertainty: row.hasUncertainty, hasUnmappedLabels: row.hasUnmappedLabels,
    warningCount: row.warningCount, createdAt: row.assetCreatedAt.getTime(), publishedAt: row.publishedAt?.getTime() ?? null,
  };
}
