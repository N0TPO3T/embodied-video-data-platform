export const TASK_SEGMENT_MATERIALIZATION_POLICY_VERSION =
  "task_segment_adaptive_cut_policy_v1" as const;

export const CUT_BOUNDARY_TOLERANCE_FRAMES = 2;
export const MIN_CUT_BOUNDARY_TOLERANCE_MS = 20;

export const EXACT_TRANSCODE_VIDEO_CODEC = "libx264" as const;
export const EXACT_TRANSCODE_PRESET = "veryfast" as const;
export const EXACT_TRANSCODE_CRF = 18;
export const EXACT_TRANSCODE_PIXEL_FORMAT = "yuv420p" as const;
export const EXACT_TRANSCODE_AUDIO_CODEC = "aac" as const;
export const EXACT_TRANSCODE_AUDIO_BITRATE = "128k" as const;

/** AAC encoder delay and container rounding should stay well below this bound. */
export const AUDIO_VIDEO_DURATION_TOLERANCE_MS = 250;

export function cutBoundaryToleranceMs(nominalFps: number): number | null {
  if (!Number.isFinite(nominalFps) || nominalFps <= 0) return null;
  return Math.max(
    (CUT_BOUNDARY_TOLERANCE_FRAMES * 1_000) / nominalFps,
    MIN_CUT_BOUNDARY_TOLERANCE_MS,
  );
}
