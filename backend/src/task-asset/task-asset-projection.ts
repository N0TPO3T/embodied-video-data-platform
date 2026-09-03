import type { EntityManager } from "typeorm";
import { TaskSegmentAssetProjectionEntity, type TaskAssetLabel } from "../database/entities/task-segment-asset-projection.entity.js";
import { taskSegmentAnnotationSchema, SegmentAnnotationError, type TaskSegmentAnnotationV1 } from "../task-segment/task-segment-annotation.js";

export const TASK_ASSET_PROJECTION_VERSION = "task_asset_projection_v1";
export const normalizeTaskAssetText = (value: string): string => value.normalize("NFKC").trim().replace(/\s+/gu, " ");
const normalized = (value: string | null | undefined): string | null => value == null ? null : normalizeTaskAssetText(value) || null;
const sorted = (values: Array<string | null | undefined>): string[] => [...new Set(values.map(normalized).filter((v): v is string => v !== null))].sort();

export function buildTaskAssetSearchText(document: TaskSegmentAnnotationV1): string {
  const { task, scene } = document;
  return sorted([
    task.description, task.verb, task.mapping?.label_name, task.object,
    scene.coarse_label, scene.fine_label, scene.mapping?.label_name,
    ...[task.object_mapping, ...task.manipulated_objects, ...task.tools].flatMap(v => [v.raw_text, v.label_name]),
    task.result.visible_postcondition, ...task.interaction_primitives, ...task.complexity_signals,
  ].map(v => v == null ? v : normalizeTaskAssetText(v).toLowerCase())).join(" ");
}

function mappedLabels(entries: TaskSegmentAnnotationV1["task"]["tools"]) {
  const unique = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    const value = { ...entry, raw_text: normalizeTaskAssetText(entry.raw_text), label_id: normalized(entry.label_id), label_name: normalized(entry.label_name) };
    unique.set(JSON.stringify(value), value);
  }
  const items = [...unique.values()];
  const matched = items.filter(v => v.mapping_status === "matched" && v.label_id && v.label_name);
  const labels = new Map<string, TaskAssetLabel>();
  for (const item of items) {
    const id = item.mapping_status === "matched" ? item.label_id : null;
    const name = (id ? item.label_name : item.raw_text || item.label_name) ?? "";
    if (name) labels.set(JSON.stringify([id, name]), { id, name });
  }
  return {
    ids: sorted(matched.map(v => v.label_id)), names: sorted(matched.map(v => v.label_name)),
    rawTexts: sorted(items.map(v => v.raw_text)),
    proposedCount: items.filter(v => v.mapping_status === "proposed").length,
    // Proposed is a subset of entries without a formal label, not "matched".
    unmappedCount: items.filter(v => v.mapping_status !== "matched" || !v.label_id).length,
    labels: [...labels.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value),
  };
}

export function buildTaskAssetProjection(input: { assetId: string; revisionId: string; document: unknown }) {
  const parsed = taskSegmentAnnotationSchema.safeParse(input.document);
  if (!parsed.success) throw new SegmentAnnotationError("TASK_ASSET_PROJECTION_INVALID_DOCUMENT");
  const document = parsed.data;
  if (document.asset_id !== input.assetId || !input.revisionId) throw new SegmentAnnotationError("TASK_ASSET_PROJECTION_BINDING_INVALID");
  const { task, scene, verification } = document;
  const sceneId = scene.mapping?.status === "matched" ? normalized(scene.mapping.label_id) : null;
  const rawScene = normalized(scene.fine_label) ?? normalized(scene.coarse_label);
  const sceneStatus = sceneId ? "matched" : rawScene ? "proposed" : "unknown";
  const objects = mappedLabels([task.object_mapping, ...task.manipulated_objects]);
  const tools = mappedLabels(task.tools);
  const taskId = task.mapping?.status === "matched" ? normalized(task.mapping.label_id) : null;
  const taskStatus = taskId ? "matched" : task.mapping?.status === "proposed" ? "proposed" : "unknown";
  return {
    assetId: input.assetId, currentAnnotationRevisionId: input.revisionId,
    projectionVersion: TASK_ASSET_PROJECTION_VERSION, sourceGroupId: document.provenance.source_group_id,
    sceneGroupKey: sceneId ? `label:${sceneId}` : rawScene ? `proposed:${rawScene.toLowerCase()}` : "unknown",
    sceneMappingStatus: sceneStatus, primarySceneId: sceneId,
    primarySceneName: sceneId ? normalized(scene.mapping?.label_name) : rawScene,
    sceneCoarseLabel: normalized(scene.coarse_label), sceneFineLabel: normalized(scene.fine_label), sceneVerification: scene.verification,
    taskDescription: task.description, taskVerb: task.verb,
    taskMappingStatus: taskStatus, taskLabelId: taskId, taskLabelName: task.mapping?.label_name ?? null, taskObjectRaw: task.object,
    objectLabelIds: objects.ids, objectLabelNames: objects.names, objectRawTexts: objects.rawTexts,
    proposedObjectCount: objects.proposedCount, unmappedObjectCount: objects.unmappedCount, objectLabels: objects.labels,
    toolLabelIds: tools.ids, toolLabelNames: tools.names, toolRawTexts: tools.rawTexts,
    proposedToolCount: tools.proposedCount, unmappedToolCount: tools.unmappedCount, toolLabels: tools.labels,
    handMode: task.hand_mode, executionPattern: task.execution_pattern, evidenceLevel: task.evidence_level,
    interactionPrimitives: sorted(task.interaction_primitives), complexitySignals: sorted(task.complexity_signals),
    modelCompletion: task.model_completion, effectiveCompletion: task.effective_completion,
    modelResultStatus: task.result.model_status, effectiveResultStatus: task.result.effective_status,
    effectiveFailureRecovery: task.failure_recovery.effective_status,
    semanticVerification: verification.semantic_verification, sourceAnnotationAcceptance: verification.source_annotation_acceptance,
    boundarySource: verification.boundary_source,
    hasUncertainty: task.uncertainty_reasons.length > 0 || task.effective_completion === "uncertain" || task.result.effective_status === "unknown",
    warningCount: verification.warnings.length,
    hasUnmappedLabels: sceneStatus !== "matched" || taskStatus !== "matched" || objects.unmappedCount > 0 || tools.unmappedCount > 0,
    searchText: buildTaskAssetSearchText(document),
  };
}

export async function upsertTaskAssetProjection(manager: EntityManager, input: Parameters<typeof buildTaskAssetProjection>[0]): Promise<void> {
  await manager.getRepository(TaskSegmentAssetProjectionEntity).upsert(buildTaskAssetProjection(input), ["assetId"]);
}
