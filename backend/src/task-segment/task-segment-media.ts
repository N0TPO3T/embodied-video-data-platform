import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { Injectable } from "@nestjs/common";

import { runMediaCommand } from "../media/media-command-runner.js";
import {
  EXACT_TRANSCODE_AUDIO_BITRATE,
  EXACT_TRANSCODE_AUDIO_CODEC,
  EXACT_TRANSCODE_CRF,
  EXACT_TRANSCODE_PIXEL_FORMAT,
  EXACT_TRANSCODE_PRESET,
  EXACT_TRANSCODE_VIDEO_CODEC,
} from "./task-segment-materialization.policy.js";

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  start_time?: string;
  duration?: string;
};

type ProbeDocument = {
  streams?: ProbeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    start_time?: string;
  };
};

type KeyframeProbeDocument = {
  frames?: Array<{
    key_frame?: number;
    best_effort_timestamp_time?: string;
    pts_time?: string;
    pkt_dts_time?: string;
  }>;
};

export type TaskSegmentMediaMetadata = {
  /** Output-file timeline start. Stream copy preserves the source timeline. */
  startMs: number;
  durationMs: number;
  videoDurationMs: number | null;
  audioDurationMs: number | null;
  sizeBytes: string;
  codec: string;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
};

export type TaskSegmentSourceMetadata = {
  codec: string;
  container: string;
  nominalFps: number;
  hasAudio: boolean;
  startMs: number;
  durationMs: number;
  timestampRisk: boolean;
};

function positiveNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`FFprobe ${field} is invalid`);
  }
  return parsed;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalDurationMs(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed * 1_000
    : null;
}

function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText ?? "1");
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) return null;
  return numerator / denominator;
}

export function parseTaskSegmentProbeOutput(
  output: string,
): TaskSegmentMediaMetadata {
  const document = JSON.parse(output) as ProbeDocument;
  const video = document.streams?.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("FFprobe found no video stream");
  const codec = video.codec_name?.trim();
  if (!codec) throw new Error("FFprobe codec is missing");
  const outputFrameRate =
    parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate);
  if (outputFrameRate === null) throw new Error("FFprobe frame rate is missing");
  return {
    // Preserve sub-millisecond probe precision for the two-frame boundary
    // check. Rounding both values independently can create a false 1ms drift.
    startMs: finiteNumber(document.format?.start_time, 0) * 1_000,
    durationMs: positiveNumber(document.format?.duration, "duration") * 1_000,
    videoDurationMs: optionalDurationMs(video.duration),
    audioDurationMs: optionalDurationMs(
      document.streams?.find((stream) => stream.codec_type === "audio")?.duration,
    ),
    sizeBytes: String(
      Math.round(positiveNumber(document.format?.size, "size")),
    ),
    codec,
    width: Math.round(positiveNumber(video.width, "width")),
    height: Math.round(positiveNumber(video.height, "height")),
    frameRate: outputFrameRate,
    hasAudio:
      document.streams?.some((stream) => stream.codec_type === "audio") ?? false,
  };
}

export function parseTaskSegmentSourceProbeOutput(
  output: string,
): TaskSegmentSourceMetadata {
  const document = JSON.parse(output) as ProbeDocument;
  const video = document.streams?.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("FFprobe found no source video stream");
  const codec = video.codec_name?.trim();
  if (!codec) throw new Error("FFprobe source codec is missing");
  const averageFps = parseFrameRate(video.avg_frame_rate);
  const realFps = parseFrameRate(video.r_frame_rate);
  const nominalFps = averageFps ?? realFps;
  if (nominalFps === null) throw new Error("FFprobe source frame rate is missing");
  const formatStartMs = Math.round(
    finiteNumber(document.format?.start_time, 0) * 1_000,
  );
  const streamStartMs = Math.round(finiteNumber(video.start_time, 0) * 1_000);
  const rateMismatch =
    averageFps === null ||
    realFps === null ||
    Math.abs(averageFps - realFps) > Math.max(0.01, nominalFps * 0.001);
  const container = document.format?.format_name?.split(",")[0]?.trim();
  if (!container) throw new Error("FFprobe source container is missing");
  return {
    codec,
    container,
    nominalFps,
    hasAudio:
      document.streams?.some((stream) => stream.codec_type === "audio") ?? false,
    startMs: formatStartMs,
    durationMs: Math.round(
      positiveNumber(document.format?.duration, "source duration") * 1_000,
    ),
    timestampRisk:
      rateMismatch || Math.abs(formatStartMs) > 1 || Math.abs(streamStartMs) > 1,
  };
}

export function parseTaskSegmentKeyframeProbeOutput(
  output: string,
  sourceDurationMs: number,
): number[] {
  const document = JSON.parse(output) as KeyframeProbeDocument;
  const timestamps = new Set<number>();
  for (const frame of document.frames ?? []) {
    if (frame.key_frame === 0) continue;
    const seconds = finiteNumber(
      frame.best_effort_timestamp_time ?? frame.pts_time ?? frame.pkt_dts_time,
      Number.NaN,
    );
    if (!Number.isFinite(seconds)) continue;
    const timestampMs = Math.round(seconds * 1_000);
    if (timestampMs < 0 || timestampMs > sourceDurationMs) continue;
    timestamps.add(timestampMs);
  }
  return [...timestamps].sort((left, right) => left - right);
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk as Buffer);
  }
  return digest.digest("hex");
}

@Injectable()
export class TaskSegmentMediaTool {
  private readonly keyframeCache = new Map<string, readonly number[] | null>();
  private readonly keyframeCacheLimit = 32;

  async inspectSource(filePath: string): Promise<TaskSegmentSourceMetadata> {
    const probe = await runMediaCommand("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    return parseTaskSegmentSourceProbeOutput(probe.stdout);
  }

  async keyframeIndex(input: {
    sourcePath: string;
    sourceSha256: string;
    sourceDurationMs: number;
  }): Promise<readonly number[] | null> {
    if (this.keyframeCache.has(input.sourceSha256)) {
      return this.keyframeCache.get(input.sourceSha256) ?? null;
    }
    let keyframes: readonly number[] | null = null;
    try {
      const probe = await runMediaCommand("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-skip_frame",
        "nokey",
        "-show_frames",
        "-show_entries",
        "frame=best_effort_timestamp_time,pts_time,pkt_dts_time,key_frame,pict_type",
        "-of",
        "json",
        input.sourcePath,
      ]);
      const parsed = parseTaskSegmentKeyframeProbeOutput(
        probe.stdout,
        input.sourceDurationMs,
      );
      keyframes = parsed.length > 0 ? parsed : null;
    } catch {
      keyframes = null;
    }
    this.rememberKeyframes(input.sourceSha256, keyframes);
    return keyframes;
  }

  async materializeByStreamCopy(input: {
    sourcePath: string;
    outputPath: string;
    requestedStartMs: number;
    requestedEndMs: number;
  }): Promise<void> {
    await runMediaCommand("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-ss",
      (input.requestedStartMs / 1_000).toFixed(3),
      "-i",
      input.sourcePath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-sn",
      "-dn",
      // Video remains on the low-cost stream-copy path. Audio is encoded only
      // to trim AAC pre-roll that otherwise makes format.start_time precede an
      // exact keyframe by more than the fixed two-frame tolerance.
      "-c:v",
      "copy",
      "-c:a",
      EXACT_TRANSCODE_AUDIO_CODEC,
      "-b:a",
      EXACT_TRANSCODE_AUDIO_BITRATE,
      "-copyts",
      "-to",
      (input.requestedEndMs / 1_000).toFixed(3),
      "-y",
      input.outputPath,
    ]);
  }

  async materializeByExactTranscode(input: {
    sourcePath: string;
    outputPath: string;
    requestedStartMs: number;
    requestedEndMs: number;
  }): Promise<void> {
    const durationMs = input.requestedEndMs - input.requestedStartMs;
    await runMediaCommand("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-ss",
      (input.requestedStartMs / 1_000).toFixed(3),
      "-i",
      input.sourcePath,
      "-t",
      (durationMs / 1_000).toFixed(3),
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-sn",
      "-dn",
      "-c:v",
      EXACT_TRANSCODE_VIDEO_CODEC,
      "-preset",
      EXACT_TRANSCODE_PRESET,
      "-crf",
      String(EXACT_TRANSCODE_CRF),
      "-pix_fmt",
      EXACT_TRANSCODE_PIXEL_FORMAT,
      "-c:a",
      EXACT_TRANSCODE_AUDIO_CODEC,
      "-b:a",
      EXACT_TRANSCODE_AUDIO_BITRATE,
      "-movflags",
      "+faststart",
      "-avoid_negative_ts",
      "make_zero",
      "-metadata:s:v:0",
      "rotate=0",
      "-y",
      input.outputPath,
    ]);
  }

  async assertFullyDecodable(filePath: string): Promise<void> {
    await runMediaCommand("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-i",
      filePath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-f",
      "null",
      "-",
    ]);
  }

  async inspect(
    filePath: string,
  ): Promise<TaskSegmentMediaMetadata & { sha256: string }> {
    const probe = await runMediaCommand("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    const metadata = parseTaskSegmentProbeOutput(probe.stdout);
    const [sha256, file] = await Promise.all([sha256File(filePath), stat(filePath)]);
    if (file.size <= 0 || metadata.sizeBytes !== String(file.size)) {
      throw new Error("FFprobe file size does not match the generated file");
    }
    return { ...metadata, sha256 };
  }

  private rememberKeyframes(
    sourceSha256: string,
    keyframes: readonly number[] | null,
  ): void {
    if (this.keyframeCache.has(sourceSha256)) {
      this.keyframeCache.delete(sourceSha256);
    }
    this.keyframeCache.set(sourceSha256, keyframes);
    const oldest = this.keyframeCache.keys().next().value as string | undefined;
    if (this.keyframeCache.size > this.keyframeCacheLimit && oldest) {
      this.keyframeCache.delete(oldest);
    }
  }
}
