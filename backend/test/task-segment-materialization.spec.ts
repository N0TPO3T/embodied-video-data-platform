import {
  parseTaskSegmentKeyframeProbeOutput,
  parseTaskSegmentProbeOutput,
  parseTaskSegmentSourceProbeOutput,
} from "../src/task-segment/task-segment-media.js";
import {
  planTaskSegmentMaterialization,
  validateTaskSegmentMaterialization,
} from "../src/task-segment/task-segment-materialization-planner.js";
import {
  CUT_BOUNDARY_TOLERANCE_FRAMES,
  MIN_CUT_BOUNDARY_TOLERANCE_MS,
  cutBoundaryToleranceMs,
} from "../src/task-segment/task-segment-materialization.policy.js";

function plan(overrides: Partial<Parameters<typeof planTaskSegmentMaterialization>[0]> = {}) {
  return planTaskSegmentMaterialization({
    requestedStartMs: 4_000,
    requestedEndMs: 8_000,
    sourceCodec: "h264",
    sourceContainer: "mov",
    sourceNominalFps: 30,
    keyframesMs: [0, 2_000, 4_000, 6_000, 8_000],
    timestampRisk: false,
    ...overrides,
  });
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    startMs: 4_000,
    durationMs: 4_000,
    videoDurationMs: 4_000,
    audioDurationMs: 4_000,
    width: 1280,
    height: 720,
    frameRate: 30,
    hasAudio: true,
    ...overrides,
  };
}

describe("adaptive task segment materialization", () => {
  it("uses fixed two-frame boundary tolerances", () => {
    expect(CUT_BOUNDARY_TOLERANCE_FRAMES).toBe(2);
    expect(MIN_CUT_BOUNDARY_TOLERANCE_MS).toBe(20);
    expect(cutBoundaryToleranceMs(25)).toBe(80);
    expect(cutBoundaryToleranceMs(30)).toBeCloseTo(66.666, 2);
    expect(cutBoundaryToleranceMs(60)).toBeCloseTo(33.333, 2);
    expect(cutBoundaryToleranceMs(0)).toBeNull();
  });

  it("selects stream copy only when the previous keyframe is within tolerance", () => {
    expect(plan()).toMatchObject({
      preferredMode: "stream_copy",
      reasonCode: "KEYFRAME_WITHIN_TOLERANCE",
      previousKeyframeMs: 4_000,
      keyframeDistanceStartMs: 0,
    });
    expect(plan({ requestedStartMs: 4_050 })).toMatchObject({
      preferredMode: "stream_copy",
      previousKeyframeMs: 4_000,
      keyframeDistanceStartMs: 50,
    });
    expect(plan({ requestedStartMs: 3_100 })).toMatchObject({
      preferredMode: "exact_clip_transcode",
      reasonCode: "KEYFRAME_DRIFT_TOO_LARGE",
      previousKeyframeMs: 2_000,
      keyframeDistanceStartMs: 1_100,
    });
  });

  it("handles video start/end and unavailable keyframe indexes deterministically", () => {
    expect(plan({ requestedStartMs: 0 })).toMatchObject({
      preferredMode: "stream_copy",
      previousKeyframeMs: 0,
    });
    expect(plan({ requestedStartMs: 8_000, requestedEndMs: 10_000 })).toMatchObject({
      preferredMode: "stream_copy",
      previousKeyframeMs: 8_000,
    });
    const missing = plan({ keyframesMs: null });
    expect(missing).toMatchObject({
      preferredMode: "exact_clip_transcode",
      reasonCode: "KEYFRAME_INDEX_UNAVAILABLE",
    });
    expect(plan({ keyframesMs: null })).toEqual(missing);
  });

  it("forces exact transcode for invalid FPS, timestamp risk, or unsupported codecs", () => {
    expect(plan({ sourceNominalFps: Number.NaN })).toMatchObject({
      preferredMode: "exact_clip_transcode",
      reasonCode: "VFR_OR_TIMESTAMP_RISK",
    });
    expect(plan({ timestampRisk: true })).toMatchObject({
      preferredMode: "exact_clip_transcode",
      reasonCode: "VFR_OR_TIMESTAMP_RISK",
    });
    expect(plan({ sourceCodec: "vp9" })).toMatchObject({
      preferredMode: "exact_clip_transcode",
      reasonCode: "STREAM_COPY_UNSUPPORTED",
    });
  });

  it("parses, filters, de-duplicates, and sorts real keyframe timestamps", () => {
    expect(parseTaskSegmentKeyframeProbeOutput(JSON.stringify({
      frames: [
        { key_frame: 1, best_effort_timestamp_time: "4.000" },
        { key_frame: 1, pts_time: "2.000" },
        { key_frame: 0, best_effort_timestamp_time: "3.000" },
        { key_frame: 1, pkt_dts_time: "2.000" },
        { key_frame: 1, best_effort_timestamp_time: "-1.000" },
        { key_frame: 1, best_effort_timestamp_time: "99.000" },
        { key_frame: 1, best_effort_timestamp_time: "invalid" },
      ],
    }), 10_000)).toEqual([2_000, 4_000]);
  });

  it("detects VFR/non-zero timestamp risk without guessing FPS", () => {
    const stable = parseTaskSegmentSourceProbeOutput(JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          avg_frame_rate: "30/1",
          r_frame_rate: "30/1",
          start_time: "0",
        },
        { codec_type: "audio", codec_name: "aac" },
      ],
      format: {
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
        start_time: "0",
        duration: "20.000",
      },
    }));
    expect(stable).toMatchObject({
      codec: "h264",
      container: "mov",
      nominalFps: 30,
      hasAudio: true,
      timestampRisk: false,
    });
    expect(parseTaskSegmentSourceProbeOutput(JSON.stringify({
      streams: [{
        codec_type: "video",
        codec_name: "h264",
        avg_frame_rate: "24000/1001",
        r_frame_rate: "30/1",
        start_time: "1.000",
      }],
      format: { format_name: "mov", start_time: "1.000", duration: "20" },
    })).timestampRisk).toBe(true);
  });

  it("requires frame-level stream-copy boundaries and audio preservation", () => {
    expect(validateTaskSegmentMaterialization({
      mode: "stream_copy",
      requestedStartMs: 4_000,
      requestedEndMs: 8_000,
      boundaryToleranceMs: 67,
      sourceHasAudio: true,
      output: output({ startMs: 3_950, durationMs: 4_060 }),
    })).toMatchObject({ status: "passed", startDriftMs: -50, endDriftMs: 10 });
    expect(validateTaskSegmentMaterialization({
      mode: "stream_copy",
      requestedStartMs: 4_000,
      requestedEndMs: 8_000,
      boundaryToleranceMs: 67,
      sourceHasAudio: true,
      output: output({ startMs: 2_000, durationMs: 6_000 }),
    })).toMatchObject({
      status: "failed",
      failureCode: "STREAM_COPY_DRIFT_EXCEEDED",
    });
    expect(validateTaskSegmentMaterialization({
      mode: "stream_copy",
      requestedStartMs: 4_000,
      requestedEndMs: 8_000,
      boundaryToleranceMs: 67,
      sourceHasAudio: true,
      output: output({ hasAudio: false, audioDurationMs: null }),
    })).toMatchObject({
      status: "failed",
      failureCode: "OUTPUT_AUDIO_STREAM_MISSING",
    });
  });

  it("maps exact transcode output duration back to the requested source timeline", () => {
    expect(validateTaskSegmentMaterialization({
      mode: "exact_clip_transcode",
      requestedStartMs: 3_100,
      requestedEndMs: 7_400,
      boundaryToleranceMs: 67,
      sourceHasAudio: false,
      output: output({
        startMs: 0,
        durationMs: 4_333,
        videoDurationMs: 4_333,
        audioDurationMs: null,
        hasAudio: false,
      }),
    })).toMatchObject({
      status: "passed",
      actualStartMs: 3_100,
      actualEndMs: 7_433,
      startDriftMs: 0,
      endDriftMs: 33,
    });
    expect(validateTaskSegmentMaterialization({
      mode: "exact_clip_transcode",
      requestedStartMs: 3_100,
      requestedEndMs: 7_400,
      boundaryToleranceMs: 67,
      sourceHasAudio: false,
      output: output({ startMs: 0, durationMs: 4_500, hasAudio: false }),
    })).toMatchObject({
      status: "failed",
      failureCode: "EXACT_TRANSCODE_DURATION_MISMATCH",
    });
  });

  it("parses output timelines and media properties", () => {
    expect(parseTaskSegmentProbeOutput(JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          avg_frame_rate: "30/1",
          duration: "4.000",
        },
        { codec_type: "audio", codec_name: "aac", duration: "4.010" },
      ],
      format: { start_time: "3.950", duration: "4.010", size: "1000" },
    }))).toEqual({
      startMs: 3_950,
      durationMs: 4_010,
      videoDurationMs: 4_000,
      audioDurationMs: 4_010,
      sizeBytes: "1000",
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      hasAudio: true,
    });
  });
});
