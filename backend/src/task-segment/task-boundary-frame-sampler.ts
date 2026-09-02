import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Injectable } from "@nestjs/common";

import {
  NodeMediaProcessRunner,
  type MediaProcessRunner,
} from "../video-quality/media-preprocessor.js";
import { boundaryWindowTimestamps } from "./task-boundary-refinement.policy.js";

export type TaskBoundarySampledFrame = {
  requestedTimestampsMs: number[];
  timestampMs: number;
  windows: Array<"start" | "end">;
  dataUrl: string;
};

export type TaskBoundarySampleManifest = {
  requestedStartTimestampsMs: number[];
  requestedEndTimestampsMs: number[];
  frames: Array<{
    requestedTimestampsMs: number[];
    timestampMs: number;
    windows: Array<"start" | "end">;
  }>;
};

export type TaskBoundaryFrameSample = {
  frames: TaskBoundarySampledFrame[];
  manifest: TaskBoundarySampleManifest;
};

export interface TaskBoundaryFrameSampler {
  extract(input: {
    sourcePath: string;
    workDirectory: string;
    coarseStartMs: number;
    coarseEndMs: number;
    videoDurationMs: number;
    signal?: AbortSignal;
  }): Promise<TaskBoundaryFrameSample>;
}

export const TASK_BOUNDARY_FRAME_SAMPLER = Symbol("TASK_BOUNDARY_FRAME_SAMPLER");

export type TaskBoundarySampleRequest = {
  timestampMs: number;
  windows: Array<"start" | "end">;
};

export function taskBoundarySamplePlan(input: {
  coarseStartMs: number;
  coarseEndMs: number;
  videoDurationMs: number;
}): {
  requestedStartTimestampsMs: number[];
  requestedEndTimestampsMs: number[];
  requests: TaskBoundarySampleRequest[];
} {
  const requestedStartTimestampsMs = boundaryWindowTimestamps(
    input.coarseStartMs,
    input.videoDurationMs,
  );
  const requestedEndTimestampsMs = boundaryWindowTimestamps(
    input.coarseEndMs,
    input.videoDurationMs,
  );
  const requested = new Map<number, Set<"start" | "end">>();
  for (const timestampMs of requestedStartTimestampsMs) {
    requested.set(timestampMs, new Set([...(requested.get(timestampMs) ?? []), "start"]));
  }
  for (const timestampMs of requestedEndTimestampsMs) {
    requested.set(timestampMs, new Set([...(requested.get(timestampMs) ?? []), "end"]));
  }
  return {
    requestedStartTimestampsMs,
    requestedEndTimestampsMs,
    requests: [...requested.entries()].map(([timestampMs, windows]) => ({
      timestampMs,
      windows: [...windows].sort(),
    })),
  };
}

function actualTimestamp(stderr: string, useLastTimestamp: boolean): number | null {
  const matches = [...stderr.matchAll(/pts_time:([-+\d.]+)/gu)];
  const value = Number(
    (useLastTimestamp ? matches.at(-1) : matches[0])?.[1],
  );
  return Number.isFinite(value) ? Math.round(value * 1_000) : null;
}

@Injectable()
export class FfmpegTaskBoundaryFrameSampler implements TaskBoundaryFrameSampler {
  constructor(
    private readonly runner: MediaProcessRunner = new NodeMediaProcessRunner(),
  ) {}

  async extract(input: {
    sourcePath: string;
    workDirectory: string;
    coarseStartMs: number;
    coarseEndMs: number;
    videoDurationMs: number;
    signal?: AbortSignal;
  }): Promise<TaskBoundaryFrameSample> {
    const plan = taskBoundarySamplePlan(input);

    const extracted = new Map<number, TaskBoundarySampledFrame>();
    for (const [index, request] of plan.requests.entries()) {
      const requestedTimestampMs = request.timestampMs;
      const windows = request.windows;
      const outputPath = join(
        input.workDirectory,
        `boundary-${String(index).padStart(3, "0")}.png`,
      );
      const seekStartMs = Math.max(0, requestedTimestampMs - 1_000);
      const timestampSeconds = (requestedTimestampMs / 1_000).toFixed(3);
      const useLastFrame = requestedTimestampMs === input.videoDurationMs;
      const frameFilter = useLastFrame
        ? `select=lte(t\\,${timestampSeconds}),showinfo,reverse,scale=480:-2`
        : `select=gte(t\\,${timestampSeconds}),showinfo,scale=480:-2`;
      const result = await this.runner.run(
        "ffmpeg",
        [
          "-hide_banner",
          "-nostdin",
          "-copyts",
          "-ss",
          (seekStartMs / 1_000).toFixed(3),
          "-i",
          input.sourcePath,
          "-an",
          "-vf",
          frameFilter,
          "-frames:v",
          "1",
          "-fps_mode",
          "vfr",
          "-q:v",
          "4",
          outputPath,
        ],
        input.signal,
      );
      const timestampMs = actualTimestamp(result.stderr, useLastFrame);
      if (
        timestampMs === null ||
        timestampMs < 0 ||
        timestampMs > input.videoDurationMs
      ) {
        throw new Error(`无法读取 ${requestedTimestampMs}ms 附近提取帧的实际时间戳`);
      }
      const existing = extracted.get(timestampMs);
      if (existing) {
        existing.requestedTimestampsMs.push(requestedTimestampMs);
        existing.requestedTimestampsMs.sort((left, right) => left - right);
        existing.windows = [...new Set([...existing.windows, ...windows])].sort();
        continue;
      }
      extracted.set(timestampMs, {
        requestedTimestampsMs: [requestedTimestampMs],
        timestampMs,
        windows: [...windows].sort(),
        dataUrl: `data:image/png;base64,${(await readFile(outputPath)).toString("base64")}`,
      });
    }
    const frames = [...extracted.values()].sort(
      (left, right) => left.timestampMs - right.timestampMs,
    );
    return {
      frames,
      manifest: {
        requestedStartTimestampsMs: plan.requestedStartTimestampsMs,
        requestedEndTimestampsMs: plan.requestedEndTimestampsMs,
        frames: frames.map(({ dataUrl: _dataUrl, ...frame }) => frame),
      },
    };
  }
}
