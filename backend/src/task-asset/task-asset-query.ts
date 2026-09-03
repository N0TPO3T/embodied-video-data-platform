import type { TaskAssetQueryDto } from "./dto/task-asset-query.dto.js";
import { TASK_ASSET_PROJECTION_VERSION } from "./task-asset-projection.js";

export const TASK_ASSET_FROM = `FROM task_segment_assets a
  JOIN annotation_runs ar ON ar.id = a.annotation_run_id AND ar.submission_id = a.submission_id
  JOIN task_segment_annotation_revisions r ON r.id = a.current_annotation_revision_id
    AND r.task_segment_asset_id = a.id AND r.source_annotation_run_id = ar.id`;

export function taskAssetBaseScope(includeHistorical: boolean): string {
  return `a.generation_status = 'ready' AND a.validation_status = 'passed'
    AND a.annotation_publication_status = 'published' AND r.publication_status = 'published'
    AND ar.execution_status = 'succeeded'
    AND ar.publication_status IN (${includeHistorical ? "'auto_accepted','human_verified','superseded'" : "'auto_accepted','human_verified'"})`;
}

export function buildTaskAssetQuery(query: TaskAssetQueryDto) {
  const params: unknown[] = [TASK_ASSET_PROJECTION_VERSION];
  const where = [taskAssetBaseScope(query.includeHistorical), "p.current_annotation_revision_id = a.current_annotation_revision_id", "p.projection_version = $1"];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const singles = {
    sceneKeys: "p.scene_group_key", sceneMappingStatuses: "p.scene_mapping_status", taskVerbs: "p.task_verb", taskLabelIds: "p.task_label_id",
    handModes: "p.hand_mode", executionPatterns: "p.execution_pattern", completions: "p.effective_completion", resultStatuses: "p.effective_result_status",
    failureRecoveryStatuses: "p.effective_failure_recovery", semanticVerifications: "p.semantic_verification", sourceAnnotationAcceptances: "p.source_annotation_acceptance",
    boundarySources: "p.boundary_source", materializationModes: "a.materialization_mode",
  } as const;
  for (const [key, column] of Object.entries(singles)) {
    const value = query[key as keyof typeof singles];
    if (value?.length) where.push(`${column} = ANY(${bind(value)}::text[])`);
  }
  for (const [key, column] of Object.entries({ objectLabelIds: "object_label_ids", toolLabelIds: "tool_label_ids", interactionPrimitives: "interaction_primitives", complexitySignals: "complexity_signals" } as const)) {
    const value = query[key as "objectLabelIds" | "toolLabelIds" | "interactionPrimitives" | "complexitySignals"];
    if (value?.length) where.push(`p.${column} && ${bind(value)}::text[]`);
  }
  for (const [key, column] of Object.entries({ hasAudio: "a.has_audio", hasUnmappedLabels: "p.has_unmapped_labels", hasUncertainty: "p.has_uncertainty" } as const)) {
    const value = query[key as "hasAudio" | "hasUnmappedLabels" | "hasUncertainty"];
    if (value !== undefined) where.push(`${column} = ${bind(value)}`);
  }
  if (query.minDurationMs !== undefined) where.push(`a.clip_duration_ms >= ${bind(query.minDurationMs)}`);
  if (query.maxDurationMs !== undefined) where.push(`a.clip_duration_ms <= ${bind(query.maxDurationMs)}`);
  if (query.sourceGroupId) where.push(`p.source_group_id = ${bind(query.sourceGroupId)}`);
  if (query.q) where.push(`p.search_text ILIKE ${bind(`%${query.q.toLowerCase().replace(/[\\%_]/gu, "\\$&")}%`)} ESCAPE E'\\\\'`);
  const from = `${TASK_ASSET_FROM} JOIN task_segment_asset_projections p ON p.asset_id = a.id WHERE ${where.join(" AND ")}`;
  const sort = { createdAt: "a.created_at", duration: "a.clip_duration_ms", scene: "p.scene_group_key", task: "p.task_description", result: "p.effective_result_status" }[query.sortBy];
  const direction = query.sortOrder === "asc" ? "ASC" : "DESC";
  return { from, params, order: `${sort} ${direction}, a.id ${direction}` };
}
