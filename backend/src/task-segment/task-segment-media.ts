import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { Injectable } from "@nestjs/common";

import { runMediaCommand } from "../media/media-command-runner.js";

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
};

type ProbeDocument = {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
    size?: string;
    start_time?: string;
  };
};

export type TaskSegmentMediaMetadata = {
  /** 输出文件时间轴上的实际起点（毫秒，绝对时间轴；stream copy 关键帧对齐后的真实值） */
  startMs: number;
  durationMs: number;
  sizeBytes: string;
  codec: string;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
};

function positiveNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`FFprobe ${field} is invalid`);
  }
  return parsed;
}

function nonNegativeNumber(value: unknown, field: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function frameRate(value: string | undefined): number {
  if (!value) throw new Error("FFprobe frame rate is missing");
  const [numerator, denominator] = value.split("/");
  return positiveNumber(numerator, "frame rate numerator") /
    positiveNumber(denominator ?? "1", "frame rate denominator");
}

export function parseTaskSegmentProbeOutput(output: string): TaskSegmentMediaMetadata {
  const document = JSON.parse(output) as ProbeDocument;
  const video = document.streams?.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("FFprobe found no video stream");
  const codec = video.codec_name?.trim();
  if (!codec) throw new Error("FFprobe codec is missing");
  return {
    startMs: Math.round(nonNegativeNumber(document.format?.start_time, "start_time", 0) * 1_000),
    durationMs: Math.round(positiveNumber(document.format?.duration, "duration") * 1_000),
    sizeBytes: String(Math.round(positiveNumber(document.format?.size, "size"))),
    codec,
    width: Math.round(positiveNumber(video.width, "width")),
    height: Math.round(positiveNumber(video.height, "height")),
    frameRate: frameRate(video.avg_frame_rate ?? video.r_frame_rate),
    hasAudio: document.streams?.some((stream) => stream.codec_type === "audio") ?? false,
  };
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
  /**
   * 正式 V1 规则（SEG-DEC-009）：保留原始格式，不做重编码（stream copy）。
   * - 使用 input seeking（-ss 在 -i 前）：实际起点会对齐到目标起点之前最近的关键帧；
   * - -copyts 保留原始时间轴，-to 按绝对位置截止，输出文件的 start_time 即实际起点；
   * - 音频原样保留（-map 0:a:0?），不转码（SEG-DEC-008）。
   */
  async transcode(input: {
    sourcePath: string;
    outputPath: string;
    startMs: number;
    endMs: number;
  }): Promise<void> {
    await runMediaCommand("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-ss",
      (input.startMs / 1_000).toFixed(3),
      "-i",
      input.sourcePath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-sn",
      "-dn",
      "-c",
      "copy",
      "-copyts",
      "-to",
      (input.endMs / 1_000).toFixed(3),
      "-y",
      input.outputPath,
    ]);
  }

  async inspect(filePath: string): Promise<TaskSegmentMediaMetadata & { sha256: string }> {
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
}
