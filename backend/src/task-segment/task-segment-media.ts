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
  };
};

export type TaskSegmentMediaMetadata = {
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
  async transcode(input: {
    sourcePath: string;
    outputPath: string;
    startMs: number;
    endMs: number;
  }): Promise<void> {
    await runMediaCommand("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-i",
      input.sourcePath,
      "-ss",
      (input.startMs / 1_000).toFixed(3),
      "-t",
      ((input.endMs - input.startMs) / 1_000).toFixed(3),
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-sn",
      "-dn",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-avoid_negative_ts",
      "make_zero",
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
