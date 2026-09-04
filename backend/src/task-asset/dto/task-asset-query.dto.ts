import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { COMPLEXITY_SIGNALS, EXECUTION_PATTERNS, INTERACTION_PRIMITIVES, TASK_VERBS } from "../../video-annotation/video-annotation.js";
import { normalizeTaskAssetText } from "../task-asset-projection.js";

const text = z.string().transform(normalizeTaskAssetText);
function multiple(allowed?: readonly string[]) {
  return z.union([z.string(), z.array(z.string()).max(20)]).transform(v =>
    [...new Set((Array.isArray(v) ? v : [v]).flatMap(s => s.split(",")).map(normalizeTaskAssetText).filter(Boolean))],
  ).pipe(z.array(z.string().min(1).max(120).refine(v => !allowed || allowed.includes(v), "Unsupported value")).max(20)).optional();
}
const boolean = z.enum(["true", "false"]).transform(v => v === "true").optional();
const positiveInteger = (max: number) => z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().min(1).max(max));
const duration = z.string().regex(/^\d+(?:\.\d+)?$/u).transform(Number).pipe(z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER)).optional();

export const taskAssetQuerySchema = z.object({
  q: text.pipe(z.string().max(200)).optional(),
  sceneKeys: multiple(), sceneMappingStatuses: multiple(["matched", "proposed", "unknown"]),
  taskVerbs: multiple(TASK_VERBS), taskLabelIds: multiple(), objectLabelIds: multiple(), toolLabelIds: multiple(),
  handModes: multiple(["left", "right", "both", "unclear", "no_hand_visible"]),
  executionPatterns: multiple(EXECUTION_PATTERNS), interactionPrimitives: multiple(INTERACTION_PRIMITIVES), complexitySignals: multiple(COMPLEXITY_SIGNALS),
  completions: multiple(["complete", "incomplete", "partial", "uncertain"]),
  resultStatuses: multiple(["success", "failure", "partial", "not_applicable", "unknown"]),
  failureRecoveryStatuses: multiple(["none_observed", "failure_without_recovery", "failure_then_recovery", "possible_failure", "ambiguous", "not_assessable"]),
  semanticVerifications: multiple(["inherited_from_published_annotation", "human_verified"]),
  sourceAnnotationAcceptances: multiple(["automatic", "human"]),
  boundarySources: multiple(["coarse", "refined", "coarse_fallback"]), materializationModes: multiple(["stream_copy", "exact_clip_transcode"]),
  hasAudio: boolean, hasUnmappedLabels: boolean, hasUncertainty: boolean,
  minDurationMs: duration, maxDurationMs: duration, sourceGroupId: text.pipe(z.string().min(1).max(120)).optional(),
  includeHistorical: boolean.transform(v => v ?? false),
  sortBy: z.enum(["createdAt", "duration", "scene", "task", "result"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: positiveInteger(1_000_000).optional().transform(v => v ?? 1),
  pageSize: positiveInteger(100).optional().transform(v => v ?? 50),
}).strict().refine(v => v.minDurationMs === undefined || v.maxDurationMs === undefined || v.minDurationMs <= v.maxDurationMs, "Invalid duration range");

export type TaskAssetQueryDto = z.infer<typeof taskAssetQuerySchema>;
export function parseTaskAssetQuery(input: unknown): TaskAssetQueryDto {
  const result = taskAssetQuerySchema.safeParse(input);
  if (!result.success) throw new BadRequestException({ code: "TASK_ASSET_QUERY_INVALID", error: "筛选参数无效", fields: [...new Set(result.error.issues.map(v => v.path[0] ?? "query"))] });
  return result.data;
}
