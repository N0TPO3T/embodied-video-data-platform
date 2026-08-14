import { spawn } from "node:child_process";

const DEFAULT_MEDIA_COMMAND_TIMEOUT_MS = 9 * 60_000;
const DEFAULT_MEDIA_COMMAND_KILL_GRACE_MS = 5_000;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;

export function mediaCommandTimeoutMs(value: string | undefined): number {
  const parsed = Number(value?.trim() || DEFAULT_MEDIA_COMMAND_TIMEOUT_MS);
  if (!Number.isInteger(parsed) || parsed < 10_000 || parsed > 3_600_000) {
    throw new Error(
      "MEDIA_COMMAND_TIMEOUT_MS 必须是 10000 到 3600000 之间的整数",
    );
  }
  return parsed;
}

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
  captureFrame(input: {
    filePath: string;
    timestampSeconds: number;
    outputPath: string;
  }): Promise<void>;
  transcodePreview(input: {
    filePath: string;
    outputPath: string;
  }): Promise<void>;
  transcodeHls(input: {
    filePath: string;
    outputDirectory: string;
  }): Promise<Array<{ quality: string; width: number; height: number }>>;
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

export type MediaCommandRunOptions = {
  timeoutMs?: number;
  killGraceMs?: number;
  spawnProcess?: typeof spawn;
};

function positiveDuration(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  const duration = value ?? fallback;
  if (!Number.isInteger(duration) || duration < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return duration;
}

export async function runMediaCommand(
  command: string,
  args: string[],
  options: MediaCommandRunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = positiveDuration(
    options.timeoutMs,
    mediaCommandTimeoutMs(
      process.env.MEDIA_COMMAND_TIMEOUT_MS ??
        process.env.MEDIA_WORKER_TASK_TIMEOUT_MS,
    ),
    "media command timeoutMs",
  );
  const killGraceMs = positiveDuration(
    options.killGraceMs,
    DEFAULT_MEDIA_COMMAND_KILL_GRACE_MS,
    "media command killGraceMs",
  );
  const spawnProcess = options.spawnProcess ?? spawn;
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let timeoutError: Error | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      timeoutTimer = null;
      killTimer = null;
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("close", onClose);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        settle(() => reject(new Error(`${command} output exceeded 16 MiB`)));
        return;
      }
      target.push(chunk);
    };
    const onStdout = (chunk: Buffer) => collect(stdout, chunk);
    const onStderr = (chunk: Buffer) => collect(stderr, chunk);
    const onError = (error: Error) => {
      settle(() => reject(timeoutError ?? error));
    };
    const onClose = (code: number | null) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (timeoutError) {
        settle(() => reject(timeoutError));
      } else if (code === 0) {
        settle(() => resolve(result));
      } else {
        settle(() =>
          reject(
            new Error(
              `${command} exited with code ${code}: ${result.stderr.slice(-2_000)}`,
            ),
          ),
        );
      }
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timeoutError = new Error(`${command} timed out after ${timeoutMs} ms`);
      killTimer = setTimeout(() => {
        if (settled) return;
        child.kill("SIGKILL");
        settle(() => reject(timeoutError!));
      }, killGraceMs);
      if (typeof killTimer.unref === "function") killTimer.unref();
      child.kill("SIGTERM");
    }, timeoutMs);
    if (typeof timeoutTimer.unref === "function") timeoutTimer.unref();
  });
}

export class FfmpegMediaCommandRunner implements MediaCommandRunner {
  private readonly runOptions: MediaCommandRunOptions;

  constructor(options: MediaCommandRunOptions = {}) {
    this.runOptions = options;
  }

  private run(command: string, args: string[]) {
    return runMediaCommand(command, args, this.runOptions);
  }

  async analyze(filePath: string): Promise<MediaCommandResult> {
    const probe = await this.run("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    const metadata = parseProbeOutput(probe.stdout);
    const detection = await this.run("ffmpeg", [
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

  async captureFrame(input: {
    filePath: string;
    timestampSeconds: number;
    outputPath: string;
  }): Promise<void> {
    await this.run("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-ss",
      Math.max(0, input.timestampSeconds).toFixed(3),
      "-i",
      input.filePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=480:-2",
      "-q:v",
      "3",
      input.outputPath,
    ]);
  }

  async transcodePreview(input: {
    filePath: string;
    outputPath: string;
  }): Promise<void> {
    await this.run("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-i",
      input.filePath,
      "-map",
      "0:v:0",
      "-an",
      "-vf",
      "scale='min(960,iw)':-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-movflags",
      "+faststart",
      input.outputPath,
    ]);
  }

  async transcodeHls(input: {
    filePath: string;
    outputDirectory: string;
  }): Promise<Array<{ quality: string; width: number; height: number }>> {
    await this.run("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-i",
      input.filePath,
      "-filter_complex",
      "[0:v:0]split=2[v720][v480];[v720]scale='min(1280,iw)':-2[v720out];[v480]scale='min(854,iw)':-2[v480out]",
      "-map",
      "[v720out]",
      "-an",
      "-c:v:0",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-map",
      "[v480out]",
      "-an",
      "-c:v:1",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "31",
      "-f",
      "hls",
      "-hls_time",
      "4",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      `${input.outputDirectory}/%v-%03d.ts`,
      "-master_pl_name",
      "master.m3u8",
      "-var_stream_map",
      "v:0,name:720p v:1,name:480p",
      `${input.outputDirectory}/%v.m3u8`,
    ]);
    return [
      { quality: "720p", width: 1280, height: 720 },
      { quality: "480p", width: 854, height: 480 },
    ];
  }
}
