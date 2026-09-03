import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import type { PublicUser } from "../auth/auth.types.js";
import { csvDocument } from "../csv/csv.js";
import { OperationsFailure } from "../operations/operations-failure.js";
import { parseTaskAssetQuery } from "./dto/task-asset-query.dto.js";
import { buildTaskAssetQuery, taskAssetBaseScope, TASK_ASSET_FROM } from "./task-asset-query.js";
import { TASK_ASSET_PROJECTION_VERSION } from "./task-asset-projection.js";
import { taskAssetItem, TASK_ASSET_SELECT, TASK_ASSET_SUMMARY, TASK_ASSET_TOTALS, TASK_ASSET_VERIFICATION_COUNTS, type TaskAssetSearchRow, type TaskAssetSummary } from "./task-asset-read-model.js";

type ValueCount = { value: string; count: number };
type LabelCount = { id: string | null; name: string; count: number };
export type TaskAssetFacets = {
  scenes: Array<{ key: string; id: string | null; name: string | null; status: string; count: number }>;
  taskVerbs: ValueCount[]; taskLabels: LabelCount[]; objects: LabelCount[]; tools: LabelCount[];
  handModes: ValueCount[]; interactionPrimitives: ValueCount[]; completions: ValueCount[]; results: ValueCount[]; semanticVerifications: ValueCount[];
};
export type TaskAssetSceneRow = Omit<TaskAssetSummary, "mappedSceneCount" | "proposedSceneCount" | "unknownSceneCount"> & {
  sceneKey: string; sceneId: string | null; sceneName: string | null; mappingStatus: string;
  completeCount: number; incompleteCount: number; partialCount: number; uncertainCompletionCount: number;
  successCount: number; failureCount: number; partialResultCount: number; unknownResultCount: number; notApplicableResultCount: number;
  topTaskVerbs: ValueCount[]; topObjects: LabelCount[]; topTools: LabelCount[];
};
type IndexHealth = { totalPublishedAssets: number; projectedCurrentAssets: number; missingProjectionAssets: number; staleProjectionAssets: number; projectionVersion: string };

function requireAdmin(actor: PublicUser): void {
  if (actor.role !== "admin") throw new OperationsFailure("FORBIDDEN", "仅管理员可访问任务片段资产库", 403);
}

// Every facet is conditional on ALL active filters; no self-exclusion and no
// query per label. Paired labels belong to this read model, not source JSON.
export const TASK_ASSET_FACET_SELECT = (() => {
  const aggregate = (sql: string, order: string) => `(SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY ${order}), '[]'::jsonb) FROM (${sql}) f)`;
  const expressions = [
    `${aggregate('SELECT "sceneGroupKey" AS key, min("primarySceneId") AS id, min("primarySceneName") AS name, min("sceneMappingStatus") AS status, count(*)::int AS count FROM filtered GROUP BY "sceneGroupKey"', 'count DESC, name ASC NULLS LAST, key ASC')} AS scenes`,
    `${aggregate('SELECT "taskLabelId" AS id, min("taskLabelName") AS name, count(*)::int AS count FROM filtered WHERE "taskLabelId" IS NOT NULL GROUP BY "taskLabelId"', 'count DESC, name ASC, id ASC')} AS "taskLabels"`,
  ];
  for (const [key, column] of Object.entries({ taskVerbs: "taskVerb", handModes: "handMode", completions: "effectiveCompletion", results: "effectiveResultStatus", semanticVerifications: "semanticVerification" })) {
    expressions.push(`${aggregate(`SELECT "${column}" AS value, count(*)::int AS count FROM filtered GROUP BY "${column}"`, 'count DESC, value ASC')} AS "${key}"`);
  }
  expressions.push(`${aggregate('SELECT value, count(DISTINCT "assetId")::int AS count FROM filtered CROSS JOIN LATERAL unnest("interactionPrimitives") value GROUP BY value', 'count DESC, value ASC')} AS "interactionPrimitives"`);
  for (const [key, column] of [["objects", "objectLabels"], ["tools", "toolLabels"]]) {
    expressions.push(`${aggregate(`SELECT label->>'id' AS id, min(label->>'name') AS name, count(DISTINCT "assetId")::int AS count FROM filtered CROSS JOIN LATERAL jsonb_array_elements("${column}") label WHERE label->>'id' IS NOT NULL GROUP BY label->>'id'`, 'count DESC, name ASC, id ASC')} AS "${key}"`);
  }
  return `SELECT ${expressions.join(",\n")}`;
})();

export const TASK_ASSET_SCENE_SELECT = `
  , scene_totals AS (
    SELECT "sceneGroupKey" AS "sceneKey", min("primarySceneId") AS "sceneId", min("primarySceneName") AS "sceneName",
      min("sceneMappingStatus") AS "mappingStatus", ${TASK_ASSET_TOTALS}, ${TASK_ASSET_VERIFICATION_COUNTS},
      count(*) FILTER (WHERE "effectiveCompletion" = 'complete')::int AS "completeCount",
      count(*) FILTER (WHERE "effectiveCompletion" = 'incomplete')::int AS "incompleteCount",
      count(*) FILTER (WHERE "effectiveCompletion" = 'partial')::int AS "partialCount",
      count(*) FILTER (WHERE "effectiveCompletion" = 'uncertain')::int AS "uncertainCompletionCount",
      count(*) FILTER (WHERE "effectiveResultStatus" = 'success')::int AS "successCount",
      count(*) FILTER (WHERE "effectiveResultStatus" = 'failure')::int AS "failureCount",
      count(*) FILTER (WHERE "effectiveResultStatus" = 'partial')::int AS "partialResultCount",
      count(*) FILTER (WHERE "effectiveResultStatus" = 'unknown')::int AS "unknownResultCount",
      count(*) FILTER (WHERE "effectiveResultStatus" = 'not_applicable')::int AS "notApplicableResultCount"
    FROM filtered GROUP BY "sceneGroupKey"
  ), entries AS (
    SELECT "assetId", "sceneGroupKey", 'verb' AS kind, NULL::text AS id, "taskVerb" AS name FROM filtered
    UNION ALL SELECT "assetId", "sceneGroupKey", 'object', label->>'id', label->>'name'
      FROM filtered CROSS JOIN LATERAL jsonb_array_elements("objectLabels") label
    UNION ALL SELECT "assetId", "sceneGroupKey", 'tool', label->>'id', label->>'name'
      FROM filtered CROSS JOIN LATERAL jsonb_array_elements("toolLabels") label
  ), entry_counts AS (
    SELECT "sceneGroupKey", kind, id, min(name) AS name, count(DISTINCT "assetId")::int AS count
    FROM entries GROUP BY "sceneGroupKey", kind, id, CASE WHEN id IS NULL THEN name END
  ), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY "sceneGroupKey", kind ORDER BY count DESC, name ASC, id ASC NULLS LAST) AS rank
    FROM entry_counts
  ), tops AS (
    SELECT "sceneGroupKey",
      jsonb_agg(jsonb_build_object('value', name, 'count', count) ORDER BY rank) FILTER (WHERE kind = 'verb') AS verbs,
      jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', count) ORDER BY rank) FILTER (WHERE kind = 'object') AS objects,
      jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', count) ORDER BY rank) FILTER (WHERE kind = 'tool') AS tools
    FROM ranked WHERE rank <= 10 GROUP BY "sceneGroupKey"
  ) SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY "assetCount" DESC, "sceneName" ASC NULLS LAST, "sceneKey" ASC), '[]'::jsonb)
      FROM (SELECT scene_totals.*, COALESCE(verbs, '[]'::jsonb) AS "topTaskVerbs", COALESCE(objects, '[]'::jsonb) AS "topObjects",
        COALESCE(tools, '[]'::jsonb) AS "topTools" FROM scene_totals LEFT JOIN tops ON tops."sceneGroupKey" = scene_totals."sceneKey") s) AS rows,
    (SELECT to_jsonb(t) FROM (SELECT ${TASK_ASSET_TOTALS} FROM filtered) t) AS totals`;

@Injectable()
export class TaskAssetService {
  constructor(private readonly dataSource: DataSource) {}

  async list(actor: PublicUser, input: unknown) {
    requireAdmin(actor);
    const query = parseTaskAssetQuery(input);
    const sql = buildTaskAssetQuery(query);
    return this.dataSource.transaction("REPEATABLE READ", async manager => {
      await manager.query("SET TRANSACTION READ ONLY");
      const [summary] = await manager.query(`WITH filtered AS (SELECT ${TASK_ASSET_SELECT} ${sql.from}) SELECT ${TASK_ASSET_SUMMARY} FROM filtered`, sql.params) as TaskAssetSummary[];
      const items = await manager.query(`SELECT ${TASK_ASSET_SELECT} ${sql.from} ORDER BY ${sql.order} LIMIT $${sql.params.length + 1} OFFSET $${sql.params.length + 2}`,
        [...sql.params, query.pageSize, (query.page - 1) * query.pageSize]) as TaskAssetSearchRow[];
      // Coverage is intentionally lifecycle-scoped, NOT narrowed by semantic
      // filters: a missing projection has no searchable semantics to filter on.
      const [indexHealth] = await manager.query(`SELECT count(*)::int AS "totalPublishedAssets",
        count(*) FILTER (WHERE p.asset_id IS NOT NULL AND p.current_annotation_revision_id = a.current_annotation_revision_id AND p.projection_version = $1)::int AS "projectedCurrentAssets",
        count(*) FILTER (WHERE p.asset_id IS NULL)::int AS "missingProjectionAssets",
        count(*) FILTER (WHERE p.asset_id IS NOT NULL AND (p.current_annotation_revision_id <> a.current_annotation_revision_id OR p.projection_version <> $1))::int AS "staleProjectionAssets",
        $1::text AS "projectionVersion" ${TASK_ASSET_FROM} LEFT JOIN task_segment_asset_projections p ON p.asset_id = a.id
        WHERE ${taskAssetBaseScope(query.includeHistorical)}`, [TASK_ASSET_PROJECTION_VERSION]) as IndexHealth[];
      return { summary: summary!, indexHealth: indexHealth!, items: items.map(taskAssetItem), pagination: {
        page: query.page, pageSize: query.pageSize, total: summary!.assetCount, totalPages: Math.ceil(summary!.assetCount / query.pageSize),
      } };
    });
  }

  async facets(actor: PublicUser, input: unknown): Promise<TaskAssetFacets> {
    requireAdmin(actor);
    const sql = buildTaskAssetQuery(parseTaskAssetQuery(input));
    const rows = await this.dataSource.query(`WITH filtered AS MATERIALIZED (SELECT ${TASK_ASSET_SELECT} ${sql.from}) ${TASK_ASSET_FACET_SELECT}`, sql.params) as TaskAssetFacets[];
    return rows[0]!;
  }

  async sceneSummary(actor: PublicUser, input: unknown) {
    requireAdmin(actor);
    const sql = buildTaskAssetQuery(parseTaskAssetQuery(input));
    const rows = await this.dataSource.query(`WITH filtered AS MATERIALIZED (SELECT ${TASK_ASSET_SELECT} ${sql.from}) ${TASK_ASSET_SCENE_SELECT}`, sql.params) as Array<{
      rows: TaskAssetSceneRow[]; totals: Pick<TaskAssetSummary, "assetCount" | "totalSegmentDurationMs" | "totalStorageBytes" | "sourceGroupCount">;
    }>;
    return rows[0]!;
  }

  async exportCsv(actor: PublicUser, input: unknown): Promise<string> {
    requireAdmin(actor);
    const sql = buildTaskAssetQuery(parseTaskAssetQuery(input));
    // Bound in SQL, not a Node-side filter or an unbounded export.
    const rows = await this.dataSource.query(`SELECT ${TASK_ASSET_SELECT} ${sql.from} ORDER BY ${sql.order} LIMIT 50001`, sql.params) as TaskAssetSearchRow[];
    if (rows.length > 50_000) throw new OperationsFailure("TASK_ASSET_EXPORT_LIMIT_EXCEEDED", "导出超过 50,000 行，请缩小筛选范围", 400);
    return taskAssetCsv(rows);
  }
}

export function taskAssetCsv(rows: TaskAssetSearchRow[]): string {
  const columns: Array<[string, (row: TaskAssetSearchRow) => string | number | boolean | null]> = [
    ["asset_id", r => r.assetId], ["current_annotation_revision_id", r => r.currentAnnotationRevisionId],
    ["annotation_revision", r => r.annotationRevision], ["is_current", r => r.isCurrent],
    ["scene_key", r => r.sceneGroupKey], ["scene_id", r => r.primarySceneId], ["scene_name", r => r.primarySceneName], ["scene_mapping_status", r => r.sceneMappingStatus],
    ["task_description", r => r.taskDescription], ["task_verb", r => r.taskVerb], ["task_label_id", r => r.taskLabelId], ["task_label_name", r => r.taskLabelName], ["task_mapping_status", r => r.taskMappingStatus],
    ["object_ids", r => r.objectLabelIds.join("|")], ["object_names", r => r.objectLabelNames.join("|")], ["object_raw_texts", r => r.objectRawTexts.join("|")],
    ["tool_ids", r => r.toolLabelIds.join("|")], ["tool_names", r => r.toolLabelNames.join("|")], ["tool_raw_texts", r => r.toolRawTexts.join("|")],
    ["hand_mode", r => r.handMode], ["execution_pattern", r => r.executionPattern], ["interaction_primitives", r => r.interactionPrimitives.join("|")], ["complexity_signals", r => r.complexitySignals.join("|")],
    ["completion", r => r.effectiveCompletion], ["result_status", r => r.effectiveResultStatus], ["failure_recovery", r => r.effectiveFailureRecovery],
    ["semantic_verification", r => r.semanticVerification], ["source_annotation_acceptance", r => r.sourceAnnotationAcceptance], ["boundary_source", r => r.boundarySource],
    ["duration_seconds", r => r.durationMs / 1000], ["width", r => r.width], ["height", r => r.height], ["frame_rate", r => r.frameRate],
    ["has_audio", r => r.hasAudio], ["materialization_mode", r => r.materializationMode], ["size_bytes", r => r.sizeBytes],
    ["source_group_id", r => r.sourceGroupId], ["has_uncertainty", r => r.hasUncertainty], ["has_unmapped_labels", r => r.hasUnmappedLabels], ["warning_count", r => r.warningCount],
    ["created_at", r => r.assetCreatedAt.toISOString()], ["published_at", r => r.publishedAt?.toISOString() ?? null],
  ];
  return csvDocument([columns.map(([name]) => name), ...rows.map(row => columns.map(([, value]) => value(row)))]);
}
