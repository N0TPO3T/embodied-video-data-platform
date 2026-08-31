import {
  ATOMIC_ACTION_VERBS,
  COMPLEXITY_SIGNALS,
  EXECUTION_PATTERNS,
  INTERACTION_PRIMITIVES,
  TASK_VERBS,
} from "./video-annotation.js";

/**
 * 确定性结构修复器：处理模型输出与 Schema 的机械性约束冲突，不依赖模型第二次输出。
 * - 枚举字段非法值 → 映射为该字段的保守合法值（证据不足语义），记录修复；
 * - 证据时间戳数组超上限 → 均匀降采样（保留首尾，仍覆盖任务时间范围），记录修复；
 * - 只有此类确定性修复解决不了的（真 JSON 损坏）才交给模型 schema_repair。
 *
 * 不修改 Schema，不修改 Prompt；修复记录进入 Gate 审计（repairable/repaired）。
 */

export type SchemaRepairChange = {
  code: string;
  fieldPath: string;
  previousValue: unknown;
  nextValue: unknown;
  message: string;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 枚举字段 → 保守合法值（模型输出非法枚举时降级到“证据不足”语义） */
const ENUM_CONSERVATIVE_VALUES: Array<{ path: string; allowed: readonly string[]; fallback: string }> = [
  { path: "task_verb", allowed: TASK_VERBS, fallback: "uncertain" },
  { path: "evidence_level", allowed: ["direct_visual", "partially_inferred", "uncertain"], fallback: "uncertain" },
  { path: "execution_pattern", allowed: EXECUTION_PATTERNS, fallback: "uncertain" },
  { path: "hand_mode", allowed: ["left", "right", "both", "unclear", "no_hand_visible"], fallback: "unclear" },
  { path: "completion", allowed: ["complete", "incomplete", "partial", "uncertain"], fallback: "uncertain" },
  { path: "result_observability", allowed: ["visible", "partial", "not_visible"], fallback: "partial" },
  { path: "result_status", allowed: ["success", "failure", "partial", "not_applicable", "unknown"], fallback: "unknown" },
  { path: "result_evidence_type", allowed: ["direct_visible_postcondition", "action_completion_only", "contextual_inference", "not_observed"], fallback: "contextual_inference" },
  { path: "failure_recovery", allowed: ["none_observed", "failure_without_recovery", "failure_then_recovery", "possible_failure", "ambiguous", "not_assessable"], fallback: "not_assessable" },
  { path: "segment_type", allowed: ["task", "transition", "unclear"], fallback: "unclear" },
  { path: "temporal_structure_type", allowed: ["single_task", "multiple_tasks", "continuous_repetitive", "unclear"], fallback: "unclear" },
  { path: "model_assessability", allowed: ["assessable", "needs_review"], fallback: "needs_review" },
] as const;

/** 证据数组上限（与 Schema 一致） */
const ARRAY_LIMITS: Array<{ path: string; limit: number }> = [
  { path: "scene.evidence_timestamps_ms", limit: 20 },
  { path: "tasks[].evidence_timestamps_ms", limit: 20 },
  { path: "tasks[].result_evidence_timestamps_ms", limit: 20 },
  { path: "tasks[].failure_evidence_timestamps_ms", limit: 20 },
  { path: "tasks[].recovery_evidence_timestamps_ms", limit: 20 },
  { path: "tasks[].atomic_action_sequence[].evidence_timestamps_ms", limit: 8 },
  { path: "coverage_segments[].evidence_timestamps_ms", limit: 100 },
] as const;

function downsample(values: number[], limit: number): number[] {
  if (values.length <= limit) return values;
  if (limit <= 1) return [values[0]!];
  const step = (values.length - 1) / (limit - 1);
  const result: number[] = [];
  for (let i = 0; i < limit; i += 1) {
    result.push(values[Math.round(i * step)]!);
  }
  return result;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function repairEnumField(
  target: JsonRecord,
  path: string,
  changes: SchemaRepairChange[],
): void {
  const config = ENUM_CONSERVATIVE_VALUES.find((item) => item.path === path);
  if (!config) return;
  const current = target[path];
  if (typeof current !== "string") return;
  if (config.allowed.includes(current as never)) return;
  target[path] = config.fallback;
  changes.push({
    code: "ENUM_VALUE_CONSERVATIVE_FIX",
    fieldPath: path,
    previousValue: current,
    nextValue: config.fallback,
    message: `枚举值 "${String(current)}" 非法，已保守映射为 "${config.fallback}"`,
  });
}

function repairArrayLimit(
  target: JsonRecord,
  path: string,
  limit: number,
  changes: SchemaRepairChange[],
  sourceTimestamps?: Set<number>,
): void {
  const current = target[path];
  if (!isNumberArray(current)) return;
  if (current.length <= limit) return;
  const next = downsample(current, limit);
  if (sourceTimestamps && sourceTimestamps.size > 0) {
    for (const [index, value] of next.entries()) {
      // 对齐到最近的采样帧，避免“引用了未提供的证据时间点”结构错误
      let best = value;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (const frame of sourceTimestamps) {
        const delta = Math.abs(frame - value);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = frame;
        }
      }
      next[index] = best;
    }
  }
  target[path] = next;
  changes.push({
    code: "EVIDENCE_ARRAY_DOWNSAMPLED",
    fieldPath: path,
    previousValue: current,
    nextValue: next,
    message: `证据数组 ${current.length} 项超过上限 ${limit}，已均匀降采样并对齐采样帧（保留首尾）`,
  });
}

function filterEnumArray(
  target: JsonRecord,
  path: string,
  allowed: readonly string[],
  changes: SchemaRepairChange[],
): void {
  const current = target[path];
  if (!Array.isArray(current)) return;
  const next = current.filter((item) => typeof item === "string" && allowed.includes(item as never));
  if (next.length === current.length) return;
  target[path] = next;
  changes.push({
    code: "ENUM_ARRAY_INVALID_FILTERED",
    fieldPath: path,
    previousValue: current,
    nextValue: next,
    message: `数组 ${path} 中存在非法枚举值，已过滤`,
  });
}


function repairNullableStringFields(
  target: JsonRecord,
  path: string,
  changes: SchemaRepairChange[],
): void {
  // 这些字段在 Schema 中为 z.string().max(...)（允许空串），模型输出 null 时归一为空串
  for (const field of ["video_summary", "task_object", "visible_postcondition"] as const) {
    const current = target[field];
    if (current === null) {
      target[field] = "";
      changes.push({
        code: "NULL_STRING_NORMALIZED",
        fieldPath: `${path}.${field}`,
        previousValue: null,
        nextValue: "",
        message: `字段 ${field} 为 null，已归一为空字符串`,
      });
    }
  }
}

function repairTask(
  task: JsonRecord,
  path: string,
  changes: SchemaRepairChange[],
  sourceTimestamps?: Set<number>,
): void {
  for (const field of ENUM_CONSERVATIVE_VALUES) {
    if (field.path === "segment_type" || field.path === "temporal_structure_type" || field.path === "model_assessability") continue;
    repairEnumField(task, field.path, changes);
  }
  repairArrayLimit(task, "evidence_timestamps_ms", 20, changes, sourceTimestamps);
  repairArrayLimit(task, "result_evidence_timestamps_ms", 20, changes, sourceTimestamps);
  repairArrayLimit(task, "failure_evidence_timestamps_ms", 20, changes, sourceTimestamps);
  repairArrayLimit(task, "recovery_evidence_timestamps_ms", 20, changes, sourceTimestamps);
  repairNullableStringFields(task, "tasks[]", changes);
  filterEnumArray(task, "interaction_primitives", INTERACTION_PRIMITIVES, changes);
  filterEnumArray(task, "complexity_signals", COMPLEXITY_SIGNALS, changes);
  const actions = task.atomic_action_sequence;
  if (Array.isArray(actions)) {
    for (const [actionIndex, value] of actions.entries()) {
      if (!isRecord(value)) continue;
      repairEnumField(value, "verb", changes);
      repairArrayLimit(value, "evidence_timestamps_ms", 8, changes, sourceTimestamps);
      void actionIndex;
    }
  }
}

export function repairSchemaOutput(
  value: unknown,
  sourceTimestamps?: Set<number>,
): {
  value: unknown;
  changes: SchemaRepairChange[];
} {
  if (!isRecord(value)) return { value, changes: [] };
  const changes: SchemaRepairChange[] = [];

  repairEnumField(value, "temporal_structure_type", changes);
  repairEnumField(value, "model_assessability", changes);
  if (value.video_summary === null) {
    value.video_summary = "";
    changes.push({
      code: "NULL_STRING_NORMALIZED",
      fieldPath: "video_summary",
      previousValue: null,
      nextValue: "",
      message: "字段 video_summary 为 null，已归一为空字符串",
    });
  }
  if (isRecord(value.scene)) {
    repairArrayLimit(value.scene, "evidence_timestamps_ms", 20, changes, sourceTimestamps);
  }
  const tasks = value.tasks;
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      if (isRecord(task)) repairTask(task, "tasks[]", changes, sourceTimestamps);
    }
  }
  const coverage = value.coverage_segments;
  if (Array.isArray(coverage)) {
    for (const segment of coverage) {
      if (!isRecord(segment)) continue;
      repairEnumField(segment, "segment_type", changes);
      repairArrayLimit(segment, "evidence_timestamps_ms", 100, changes, sourceTimestamps);
    }
  }
  return { value, changes };
}