import {
  AUDIO_VIDEO_DURATION_TOLERANCE_MS,
  MIN_CUT_BOUNDARY_TOLERANCE_MS,
  TASK_SEGMENT_MATERIALIZATION_POLICY_VERSION,
  cutBoundaryToleranceMs,
} from "./task-segment-materialization.policy.js";

export type TaskSegmentMaterializationMode =
  | "stream_copy"
  | "exact_clip_transcode";

export type TaskSegmentMaterializationReasonCode =
  | "KEYFRAME_WITHIN_TOLERANCE"
  | "KEYFRAME_DRIFT_TOO_LARGE"
  | "KEYFRAME_INDEX_UNAVAILABLE"
  | "VFR_OR_TIMESTAMP_RISK"
  | "STREAM_COPY_UNSUPPORTED";

export type TaskSegmentMaterializationPlan = {
  policyVersion: typeof TASK_SEGMENT_MATERIALIZATION_POLICY_VERSION;
  requestedStartMs: number;
  requestedEndMs: number;
  sourceCodec: string;
  sourceContainer: string;
  sourceNominalFps: number;
  boundaryToleranceMs: number;
  previousKeyframeMs: number | null;
  keyframeDistanceStartMs: number | null;
  preferredMode: TaskSegmentMaterializationMode;
  reasonCode: TaskSegmentMaterializationReasonCode;
};

const MP4_STREAM_COPY_VIDEO_CODECS = new Set([
  "av1",
  "h264",
  "hevc",
  "mpeg4",
]);

function previousKeyframe(
  keyframesMs: readonly number[] | null,
  requestedStartMs: number,
): number | null {
  if (!keyframesMs || keyframesMs.length === 0) return null;
  let selected: number | null = null;
  for (const timestampMs of keyframesMs) {
    if (!Number.isFinite(timestampMs) || timestampMs < 0) continue;
    if (timestampMs > requestedStartMs) break;
    selected = timestampMs;
  }
  return selected;
}

export function planTaskSegmentMaterialization(input: {
  requestedStartMs: number;
  requestedEndMs: number;
  sourceCodec: string;
  sourceContainer: string;
  sourceNominalFps: number;
  keyframesMs: readonly number[] | null;
  timestampRisk: boolean;
}): TaskSegmentMaterializationPlan {
  if (
    !Number.isFinite(input.requestedStartMs) ||
    !Number.isFinite(input.requestedEndMs) ||
    input.requestedStartMs < 0 ||
    input.requestedEndMs <= input.requestedStartMs
  ) {
    throw new Error("requested task segment interval is invalid");
  }

  const tolerance = cutBoundaryToleranceMs(input.sourceNominalFps);
  const usableTolerance = tolerance ?? MIN_CUT_BOUNDARY_TOLERANCE_MS;
  const base = {
    policyVersion: TASK_SEGMENT_MATERIALIZATION_POLICY_VERSION,
    requestedStartMs: input.requestedStartMs,
    requestedEndMs: input.requestedEndMs,
    sourceCodec: input.sourceCodec,
    sourceContainer: input.sourceContainer,
    sourceNominalFps: input.sourceNominalFps,
    boundaryToleranceMs: usableTolerance,
  };

  if (tolerance === null || input.timestampRisk) {
    return {
      ...base,
      previousKeyframeMs: null,
      keyframeDistanceStartMs: null,
      preferredMode: "exact_clip_transcode",
      reasonCode: "VFR_OR_TIMESTAMP_RISK",
    };
  }
  if (!MP4_STREAM_COPY_VIDEO_CODECS.has(input.sourceCodec.toLowerCase())) {
    return {
      ...base,
      previousKeyframeMs: null,
      keyframeDistanceStartMs: null,
      preferredMode: "exact_clip_transcode",
      reasonCode: "STREAM_COPY_UNSUPPORTED",
    };
  }
  const keyframe = previousKeyframe(input.keyframesMs, input.requestedStartMs);
  if (keyframe === null) {
    return {
      ...base,
      previousKeyframeMs: null,
      keyframeDistanceStartMs: null,
      preferredMode: "exact_clip_transcode",
      reasonCode: "KEYFRAME_INDEX_UNAVAILABLE",
    };
  }
  const distance = input.requestedStartMs - keyframe;
  return {
    ...base,
    previousKeyframeMs: keyframe,
    keyframeDistanceStartMs: distance,
    preferredMode:
      distance <= tolerance ? "stream_copy" : "exact_clip_transcode",
    reasonCode:
      distance <= tolerance
        ? "KEYFRAME_WITHIN_TOLERANCE"
        : "KEYFRAME_DRIFT_TOO_LARGE",
  };
}

export type TaskSegmentValidationFailureCode =
  | "STREAM_COPY_DRIFT_EXCEEDED"
  | "EXACT_TRANSCODE_DURATION_MISMATCH"
  | "OUTPUT_VIDEO_STREAM_MISSING"
  | "OUTPUT_AUDIO_STREAM_MISSING"
  | "OUTPUT_DECODE_FAILED";

export type TaskSegmentMaterializationValidation = {
  status: "passed" | "failed";
  failureCode: TaskSegmentValidationFailureCode | null;
  failureMessage: string | null;
  actualStartMs: number;
  actualEndMs: number;
  startDriftMs: number;
  endDriftMs: number;
};

// FFprobe serializes timestamps with six decimal places in seconds. Allow only
// that 1µs measurement quantum so an exact two-frame boundary is not rejected
// after decimal serialization; this does not widen the policy tolerance.
const FFPROBE_TIMESTAMP_QUANTIZATION_MS = 0.001;

export function validateTaskSegmentMaterialization(input: {
  mode: TaskSegmentMaterializationMode;
  requestedStartMs: number;
  requestedEndMs: number;
  boundaryToleranceMs: number;
  sourceHasAudio: boolean;
  output: {
    startMs: number;
    durationMs: number;
    videoDurationMs: number | null;
    audioDurationMs: number | null;
    width: number;
    height: number;
    frameRate: number;
    hasAudio: boolean;
  };
}): TaskSegmentMaterializationValidation {
  const requestedDurationMs = input.requestedEndMs - input.requestedStartMs;
  const output = input.output;
  const basicVideoValid =
    Number.isFinite(output.durationMs) &&
    output.durationMs > 0 &&
    Number.isFinite(output.width) &&
    output.width > 0 &&
    Number.isFinite(output.height) &&
    output.height > 0 &&
    Number.isFinite(output.frameRate) &&
    output.frameRate > 0;
  if (!basicVideoValid) {
    return failedValidation(
      "OUTPUT_VIDEO_STREAM_MISSING",
      "输出缺少有效、可解码的视频轨",
      input.requestedStartMs,
      input.requestedEndMs,
    );
  }
  if (input.sourceHasAudio && !output.hasAudio) {
    return failedValidation(
      "OUTPUT_AUDIO_STREAM_MISSING",
      "源视频包含音频，但输出片段缺少音频轨",
      input.requestedStartMs,
      input.requestedEndMs,
    );
  }
  if (
    output.videoDurationMs !== null &&
    output.audioDurationMs !== null &&
    Math.abs(output.videoDurationMs - output.audioDurationMs) >
      AUDIO_VIDEO_DURATION_TOLERANCE_MS
  ) {
    return failedValidation(
      "OUTPUT_DECODE_FAILED",
      "输出音视频轨时长差超过允许范围",
      input.requestedStartMs,
      input.requestedEndMs,
    );
  }

  if (input.mode === "stream_copy") {
    const actualStartMs = output.startMs;
    const actualEndMs = output.startMs + output.durationMs;
    const startDriftMs = actualStartMs - input.requestedStartMs;
    const endDriftMs = actualEndMs - input.requestedEndMs;
    const measuredToleranceMs =
      input.boundaryToleranceMs + FFPROBE_TIMESTAMP_QUANTIZATION_MS;
    const passed =
      Math.abs(startDriftMs) <= measuredToleranceMs &&
      Math.abs(endDriftMs) <= measuredToleranceMs &&
      actualStartMs <= input.requestedStartMs + measuredToleranceMs &&
      actualEndMs >= input.requestedEndMs - measuredToleranceMs;
    return passed
      ? {
          status: "passed",
          failureCode: null,
          failureMessage: null,
          actualStartMs,
          actualEndMs,
          startDriftMs,
          endDriftMs,
        }
      : {
          status: "failed",
          failureCode: "STREAM_COPY_DRIFT_EXCEEDED",
          failureMessage: `stream-copy 边界漂移超过 ${input.boundaryToleranceMs.toFixed(1)}ms`,
          actualStartMs,
          actualEndMs,
          startDriftMs,
          endDriftMs,
        };
  }

  const actualStartMs = input.requestedStartMs;
  const actualEndMs = input.requestedStartMs + output.durationMs;
  const startDriftMs = 0;
  const endDriftMs = output.durationMs - requestedDurationMs;
  const timelineStartsNearZero =
    output.startMs >= -input.boundaryToleranceMs &&
    Math.abs(output.startMs) <= input.boundaryToleranceMs;
  if (
    Math.abs(endDriftMs) > input.boundaryToleranceMs ||
    !timelineStartsNearZero
  ) {
    return {
      status: "failed",
      failureCode: "EXACT_TRANSCODE_DURATION_MISMATCH",
      failureMessage: `精确转码时长或输出起点超过 ${input.boundaryToleranceMs.toFixed(1)}ms 容忍范围`,
      actualStartMs,
      actualEndMs,
      startDriftMs,
      endDriftMs,
    };
  }
  return {
    status: "passed",
    failureCode: null,
    failureMessage: null,
    actualStartMs,
    actualEndMs,
    startDriftMs,
    endDriftMs,
  };
}

function failedValidation(
  failureCode: TaskSegmentValidationFailureCode,
  failureMessage: string,
  requestedStartMs: number,
  requestedEndMs: number,
): TaskSegmentMaterializationValidation {
  return {
    status: "failed",
    failureCode,
    failureMessage,
    actualStartMs: requestedStartMs,
    actualEndMs: requestedEndMs,
    startDriftMs: 0,
    endDriftMs: 0,
  };
}
