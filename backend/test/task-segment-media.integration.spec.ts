import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMediaCommand } from "../src/media/media-command-runner.js";
import { TaskSegmentMediaTool } from "../src/task-segment/task-segment-media.js";
import {
  planTaskSegmentMaterialization,
  validateTaskSegmentMaterialization,
} from "../src/task-segment/task-segment-materialization-planner.js";

const MEDIA_COMMANDS_AVAILABLE = ["ffmpeg", "ffprobe"].every(
  (command) => spawnSync(command, ["-version"], { stdio: "ignore" }).status === 0,
);

const mediaDescribe = MEDIA_COMMANDS_AVAILABLE ? describe : describe.skip;

async function generateSource(input: {
  path: string;
  durationSeconds: number;
  fps: number;
  withAudio: boolean;
}): Promise<void> {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=320x180:rate=${input.fps}:duration=${input.durationSeconds}`,
  ];
  if (input.withAudio) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=880:sample_rate=48000:duration=${input.durationSeconds}`,
      "-shortest",
    );
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(input.fps * 2),
    "-keyint_min",
    String(input.fps * 2),
    "-sc_threshold",
    "0",
  );
  if (input.withAudio) {
    args.push("-c:a", "aac", "-b:a", "128k");
  }
  args.push("-movflags", "+faststart", "-y", input.path);
  await runMediaCommand("ffmpeg", args);
}

async function extractRgbFrame(input: {
  sourcePath: string;
  timestampSeconds: number;
  outputPath: string;
}): Promise<Buffer> {
  await runMediaCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    input.timestampSeconds.toFixed(6),
    "-i",
    input.sourcePath,
    "-frames:v",
    "1",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "-y",
    input.outputPath,
  ]);
  return readFile(input.outputPath);
}

async function extractRgbFrameNumber(input: {
  sourcePath: string;
  frameNumber: number;
  outputPath: string;
}): Promise<Buffer> {
  await runMediaCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input.sourcePath,
    "-vf",
    `select=eq(n\\,${input.frameNumber})`,
    "-frames:v",
    "1",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "-y",
    input.outputPath,
  ]);
  return readFile(input.outputPath);
}

function meanAbsolutePixelError(left: Buffer, right: Buffer): number {
  expect(left.length).toBe(right.length);
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs(left[index]! - right[index]!);
  }
  return total / left.length;
}

mediaDescribe("task segment media FFmpeg integration", () => {
  let directory: string;
  let sourcePath: string;
  const media = new TaskSegmentMediaTool();

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "evdp-adaptive-cut-test-"));
    sourcePath = join(directory, "timeline-30fps-gop2s.mp4");
    await generateSource({
      path: sourcePath,
      durationSeconds: 20,
      fps: 30,
      withAudio: true,
    });
  }, 120_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("accepts a keyframe-aligned video-copy candidate with audio", async () => {
    const source = await media.inspectSource(sourcePath);
    const keyframes = await media.keyframeIndex({
      sourcePath,
      sourceSha256: "a".repeat(64),
      sourceDurationMs: source.durationMs,
    });
    expect(keyframes?.slice(0, 5)).toEqual([0, 2_000, 4_000, 6_000, 8_000]);
    const plan = planTaskSegmentMaterialization({
      requestedStartMs: 4_000,
      requestedEndMs: 8_000,
      sourceCodec: source.codec,
      sourceContainer: source.container,
      sourceNominalFps: source.nominalFps,
      keyframesMs: keyframes,
      timestampRisk: source.timestampRisk,
    });
    expect(plan).toMatchObject({
      preferredMode: "stream_copy",
      previousKeyframeMs: 4_000,
      keyframeDistanceStartMs: 0,
    });

    const outputPath = join(directory, "aligned-copy.mp4");
    await media.materializeByStreamCopy({
      sourcePath,
      outputPath,
      requestedStartMs: 4_000,
      requestedEndMs: 8_000,
    });
    await media.assertFullyDecodable(outputPath);
    const output = await media.inspect(outputPath);
    expect(validateTaskSegmentMaterialization({
      mode: "stream_copy",
      requestedStartMs: 4_000,
      requestedEndMs: 8_000,
      boundaryToleranceMs: plan.boundaryToleranceMs,
      sourceHasAudio: true,
      output,
    })).toMatchObject({ status: "passed" });
    expect(output).toMatchObject({ codec: "h264", hasAudio: true });
  }, 120_000);

  it("uses exact transcode away from a keyframe and aligns first/last visuals", async () => {
    const source = await media.inspectSource(sourcePath);
    const keyframes = await media.keyframeIndex({
      sourcePath,
      sourceSha256: "a".repeat(64),
      sourceDurationMs: source.durationMs,
    });
    const plan = planTaskSegmentMaterialization({
      requestedStartMs: 3_100,
      requestedEndMs: 7_400,
      sourceCodec: source.codec,
      sourceContainer: source.container,
      sourceNominalFps: source.nominalFps,
      keyframesMs: keyframes,
      timestampRisk: source.timestampRisk,
    });
    expect(plan).toMatchObject({
      preferredMode: "exact_clip_transcode",
      previousKeyframeMs: 2_000,
      keyframeDistanceStartMs: 1_100,
    });

    const outputPath = join(directory, "exact-3.1-7.4.mp4");
    await media.materializeByExactTranscode({
      sourcePath,
      outputPath,
      requestedStartMs: 3_100,
      requestedEndMs: 7_400,
    });
    await media.assertFullyDecodable(outputPath);
    const output = await media.inspect(outputPath);
    const validation = validateTaskSegmentMaterialization({
      mode: "exact_clip_transcode",
      requestedStartMs: 3_100,
      requestedEndMs: 7_400,
      boundaryToleranceMs: plan.boundaryToleranceMs,
      sourceHasAudio: true,
      output,
    });
    expect(validation).toMatchObject({ status: "passed", actualStartMs: 3_100 });

    const exactFirst = await extractRgbFrameNumber({
      sourcePath: outputPath,
      frameNumber: 0,
      outputPath: join(directory, "exact-first.rgb"),
    });
    const sourceFirst = await extractRgbFrame({
      sourcePath,
      timestampSeconds: 3.1,
      outputPath: join(directory, "source-3.1.rgb"),
    });
    const oldKeyframe = await extractRgbFrame({
      sourcePath,
      timestampSeconds: 2,
      outputPath: join(directory, "source-2.0.rgb"),
    });
    const firstError = meanAbsolutePixelError(exactFirst, sourceFirst);
    expect(firstError).toBeLessThan(meanAbsolutePixelError(exactFirst, oldKeyframe));

    const exactLast = await extractRgbFrameNumber({
      sourcePath: outputPath,
      frameNumber: 128,
      outputPath: join(directory, "exact-last.rgb"),
    });
    const sourceLast = await extractRgbFrame({
      sourcePath,
      timestampSeconds: 7.367,
      outputPath: join(directory, "source-7.367.rgb"),
    });
    const oldEnd = await extractRgbFrame({
      sourcePath,
      timestampSeconds: 6,
      outputPath: join(directory, "source-6.0.rgb"),
    });
    expect(meanAbsolutePixelError(exactLast, sourceLast)).toBeLessThan(
      meanAbsolutePixelError(exactLast, oldEnd),
    );
  }, 120_000);

  it.each([25, 30, 60])(
    "keeps exact no-audio output within two frames at %i FPS",
    async (fps) => {
      const rateSourcePath = join(directory, `source-${fps}fps-no-audio.mp4`);
      await generateSource({
        path: rateSourcePath,
        durationSeconds: 6,
        fps,
        withAudio: false,
      });
      const source = await media.inspectSource(rateSourcePath);
      const outputPath = join(directory, `exact-${fps}fps-no-audio.mp4`);
      await media.materializeByExactTranscode({
        sourcePath: rateSourcePath,
        outputPath,
        requestedStartMs: 1_100,
        requestedEndMs: 3_700,
      });
      await media.assertFullyDecodable(outputPath);
      const output = await media.inspect(outputPath);
      const plan = planTaskSegmentMaterialization({
        requestedStartMs: 1_100,
        requestedEndMs: 3_700,
        sourceCodec: source.codec,
        sourceContainer: source.container,
        sourceNominalFps: source.nominalFps,
        keyframesMs: null,
        timestampRisk: source.timestampRisk,
      });
      expect(validateTaskSegmentMaterialization({
        mode: "exact_clip_transcode",
        requestedStartMs: 1_100,
        requestedEndMs: 3_700,
        boundaryToleranceMs: plan.boundaryToleranceMs,
        sourceHasAudio: false,
        output,
      })).toMatchObject({ status: "passed" });
      expect(output).toMatchObject({
        codec: "h264",
        hasAudio: false,
        width: 320,
        height: 180,
      });
    },
    120_000,
  );

  it("handles non-zero timestamps, VFR risk, and rotation on the exact path", async () => {
    const nonZeroPath = join(directory, "source-nonzero-start.mp4");
    await runMediaCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-itsoffset",
      "2",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=6",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-copyts",
      "-y",
      nonZeroPath,
    ]);
    const nonZeroSource = await media.inspectSource(nonZeroPath);
    expect(nonZeroSource).toMatchObject({ startMs: 2_000, timestampRisk: true });
    const nonZeroPlan = planTaskSegmentMaterialization({
      requestedStartMs: 1_100,
      requestedEndMs: 3_700,
      sourceCodec: nonZeroSource.codec,
      sourceContainer: nonZeroSource.container,
      sourceNominalFps: nonZeroSource.nominalFps,
      keyframesMs: null,
      timestampRisk: nonZeroSource.timestampRisk,
    });
    expect(nonZeroPlan).toMatchObject({
      preferredMode: "exact_clip_transcode",
      reasonCode: "VFR_OR_TIMESTAMP_RISK",
    });
    const nonZeroOutputPath = join(directory, "exact-nonzero-start.mp4");
    await media.materializeByExactTranscode({
      sourcePath: nonZeroPath,
      outputPath: nonZeroOutputPath,
      requestedStartMs: 1_100,
      requestedEndMs: 3_700,
    });
    await media.assertFullyDecodable(nonZeroOutputPath);
    expect(validateTaskSegmentMaterialization({
      mode: "exact_clip_transcode",
      requestedStartMs: 1_100,
      requestedEndMs: 3_700,
      boundaryToleranceMs: nonZeroPlan.boundaryToleranceMs,
      sourceHasAudio: false,
      output: await media.inspect(nonZeroOutputPath),
    })).toMatchObject({ status: "passed" });

    const vfrPath = join(directory, "source-vfr.mp4");
    await runMediaCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=6",
      "-vf",
      "select=if(lt(t\\,3)\\,not(mod(n\\,2))\\,not(mod(n\\,3)))",
      "-fps_mode",
      "vfr",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-y",
      vfrPath,
    ]);
    const vfrSource = await media.inspectSource(vfrPath);
    expect(vfrSource.timestampRisk).toBe(true);
    const vfrPlan = planTaskSegmentMaterialization({
      requestedStartMs: 1_100,
      requestedEndMs: 3_700,
      sourceCodec: vfrSource.codec,
      sourceContainer: vfrSource.container,
      sourceNominalFps: vfrSource.nominalFps,
      keyframesMs: null,
      timestampRisk: vfrSource.timestampRisk,
    });
    expect(vfrPlan.preferredMode).toBe("exact_clip_transcode");
    const vfrOutputPath = join(directory, "exact-vfr.mp4");
    await media.materializeByExactTranscode({
      sourcePath: vfrPath,
      outputPath: vfrOutputPath,
      requestedStartMs: 1_100,
      requestedEndMs: 3_700,
    });
    await media.assertFullyDecodable(vfrOutputPath);
    expect(validateTaskSegmentMaterialization({
      mode: "exact_clip_transcode",
      requestedStartMs: 1_100,
      requestedEndMs: 3_700,
      boundaryToleranceMs: vfrPlan.boundaryToleranceMs,
      sourceHasAudio: false,
      output: await media.inspect(vfrOutputPath),
    })).toMatchObject({ status: "passed" });

    const rotatedPath = join(directory, "source-rotated.mp4");
    await runMediaCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-display_rotation:v:0",
      "90",
      "-i",
      sourcePath,
      "-t",
      "6",
      "-c",
      "copy",
      "-y",
      rotatedPath,
    ]);
    const rotatedOutputPath = join(directory, "exact-rotated.mp4");
    await media.materializeByExactTranscode({
      sourcePath: rotatedPath,
      outputPath: rotatedOutputPath,
      requestedStartMs: 1_000,
      requestedEndMs: 3_500,
    });
    await media.assertFullyDecodable(rotatedOutputPath);
    const rotatedOutput = await media.inspect(rotatedOutputPath);
    expect(rotatedOutput).toMatchObject({
      width: 180,
      height: 320,
      codec: "h264",
      hasAudio: true,
    });
    expect(validateTaskSegmentMaterialization({
      mode: "exact_clip_transcode",
      requestedStartMs: 1_000,
      requestedEndMs: 3_500,
      boundaryToleranceMs: 2_000 / 30,
      sourceHasAudio: true,
      output: rotatedOutput,
    })).toMatchObject({ status: "passed" });
  }, 120_000);
});
