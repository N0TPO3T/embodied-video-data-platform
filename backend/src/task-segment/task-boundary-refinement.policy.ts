export const TASK_BOUNDARY_REFINEMENT_POLICY_VERSION =
  "task_boundary_refinement_policy_v1" as const;
export const TASK_BOUNDARY_REFINEMENT_PROMPT_VERSION =
  "task_boundary_refinement_prompt_v1" as const;
export const TASK_BOUNDARY_WINDOW_BEFORE_MS = 3_000;
export const TASK_BOUNDARY_WINDOW_AFTER_MS = 3_000;
export const TASK_BOUNDARY_SAMPLE_INTERVAL_MS = 1_000;
export const TASK_BOUNDARY_LOCAL_FPS = 1;

export function taskBoundaryRefinementEnabled(
  value = process.env.TASK_BOUNDARY_REFINEMENT_ENABLED,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error("TASK_BOUNDARY_REFINEMENT_ENABLED 必须是 true 或 false");
}

export function boundaryWindowTimestamps(
  coarseTimestampMs: number,
  videoDurationMs: number,
): number[] {
  const values = new Set<number>();
  for (
    let offset = -TASK_BOUNDARY_WINDOW_BEFORE_MS;
    offset <= TASK_BOUNDARY_WINDOW_AFTER_MS;
    offset += TASK_BOUNDARY_SAMPLE_INTERVAL_MS
  ) {
    values.add(Math.min(videoDurationMs, Math.max(0, coarseTimestampMs + offset)));
  }
  return [...values].sort((left, right) => left - right);
}
