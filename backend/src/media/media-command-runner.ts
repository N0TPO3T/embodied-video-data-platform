import { spawn } from "node:child_process";

export type DetectedMediaSegment = {
  type: "black" | "freeze";
  startSeconds: number;
  endSeconds: number;
};

export type MediaProbeMetadata = {
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  bitrate: number | null;
  sizeBytes: number;
  rawProbe: Record<string, unknown>;
};

export type MediaCommandResult = {
  metadata: MediaProbeMetadata;
  segments: DetectedMediaSegment[];
};

export interface MediaCommandRunner {
  analyze(filePath: string): Promise<MediaCommandResult>;
}

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
};

type ProbeDocument = {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
    size?: string;
    bit_rate?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function positiveNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`FFprobe ${field} is invalid`);
  }
  return parsed;
}

function parseFrameRate(value: string | undefined): number {
  if (!value) throw new Error("FFprobe frame rate is missing");
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = positiveNumber(numeratorText, "frame rate numerator");
  const denominator = denominatorText
    ? positiveNumber(denominatorText, "frame rate denominator")
    : 1;
  return numerator / denominator;
}

export function parseProbeOutput(output: string): MediaProbeMetadata {
  const document = JSON.parse(output) as ProbeDocument;
  const stream = document.streams?.find(
    (candidate) => candidate.codec_type === "video",
  );
  if (!stream) throw new Error("FFprobe found no video stream");
  const durationSeconds = positiveNumber(
    document.format?.duration,
    "duration",
  );
  const width = positiveNumber(stream.width, "width");
  const height = positiveNumber(stream.height, "height");
  const frameRate = parseFrameRate(
    stream.avg_frame_rate ?? stream.r_frame_rate,
  );
  const codec = stream.codec_name?.trim();
  if (!codec) throw new Error("FFprobe codec is missing");
  const rawBitrate = stream.bit_rate ?? document.format?.bit_rate;
  const bitrate =
    rawBitrate === undefined ? null : positiveNumber(rawBitrate, "bitrate");
  return {
    durationSeconds,
    width,
    height,
    frameRate,
    codec,
    bitrate,
    sizeBytes: positiveNumber(document.format?.size, "size"),
    rawProbe: document,
  };
}

export function parseDetectionOutput(
  output: string,
): DetectedMediaSegment[] {
  const segments: DetectedMediaSegment[] = [];
  let freezeStart: number | null = null;
  for (const line of output.split(/\r?\n/u)) {
    const black = line.match(
      /black_start:(?<start>-?\d+(?:\.\d+)?)\s+black_end:(?<end>-?\d+(?:\.\d+)?)/u,
    );
    if (black?.groups) {
      segments.push({
        type: "black",
        startSeconds: Number(black.groups.start),
        endSeconds: Number(black.groups.end),
      });
    }
    const start = line.match(
      /freeze_start:(?<value>-?\d+(?:\.\d+)?)/u,
    );
    if (start?.groups) freezeStart = Number(start.groups.value);
    const end = line.match(/freeze_end:(?<value>-?\d+(?:\.\d+)?)/u);
    if (end?.groups && freezeStart !== null) {
      segments.push({
        type: "freeze",
        startSeconds: freezeStart,
        endSeconds: Number(end.groups.value),
      });
      freezeStart = null;
    }
  }
  return segments;
}

export function normalizeDetectedSegments(
  segments: DetectedMediaSegment[],
  durationSeconds: number,
): DetectedMediaSegment[] {
  const clipped = segments
    .map((segment) => ({
      type: segment.type,
      startSeconds: Math.max(0, Math.min(durationSeconds, segment.startSeconds)),
      endSeconds: Math.max(0, Math.min(durationSeconds, segment.endSeconds)),
    }))
    .filter(
      (segment) =>
        Number.isFinite(segment.startSeconds) &&
        Number.isFinite(segment.endSeconds) &&
        segment.endSeconds > segment.startSeconds,
    )
    .sort(
      (left, right) =>
        left.startSeconds - right.startSeconds ||
        left.endSeconds - right.endSeconds,
    );
  const merged: DetectedMediaSegment[] = [];
  for (const segment of clipped) {
    const previous = [...merged]
      .reverse()
      .find((candidate) => candidate.type === segment.type);
    if (
      previous &&
      segment.startSeconds <= previous.endSeconds + 0.05
    ) {
      previous.endSeconds = Math.max(
        previous.endSeconds,
        segment.endSeconds,
      );
    } else {
      merged.push({ ...segment });
    }
  }
  return merged.sort(
    (left, right) =>
      left.startSeconds - right.startSeconds ||
      left.endSeconds - right.endSeconds,
  );
}

async function run(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 16 * 1024 * 1024) {
        child.kill("SIGKILL");
        reject(new Error(`${command} output exceeded 16 MiB`));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) resolve(result);
      else reject(new Error(`${command} exited with code ${code}: ${result.stderr.slice(-2_000)}`));
    });
  });
}

export class FfmpegMediaCommandRunner implements MediaCommandRunner {
  async analyze(filePath: string): Promise<MediaCommandResult> {
    const probe = await run("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    const metadata = parseProbeOutput(probe.stdout);
    const detection = await run("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-i",
      filePath,
      "-an",
      "-vf",
      "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-50dB:d=2",
      "-f",
      "null",
      "-",
    ]);
    return {
      metadata,
      segments: normalizeDetectedSegments(
        parseDetectionOutput(detection.stderr),
        metadata.durationSeconds,
      ),
    };
  }
}
