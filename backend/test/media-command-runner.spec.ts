import {
  normalizeDetectedSegments,
  parseDetectionOutput,
  parseProbeOutput,
} from "../src/media/media-command-runner.js";

describe("media command output parsing", () => {
  it("extracts authoritative video metadata from FFprobe JSON", () => {
    const result = parseProbeOutput(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
            avg_frame_rate: "60000/1001",
            bit_rate: "12000000",
          },
          { codec_type: "audio", codec_name: "aac" },
        ],
        format: {
          duration: "1814.125",
          size: "2718281828",
          bit_rate: "11950000",
        },
      }),
    );

    expect(result).toMatchObject({
      durationSeconds: 1814.125,
      width: 1920,
      height: 1080,
      codec: "h264",
      bitrate: 12_000_000,
      sizeBytes: 2_718_281_828,
    });
    expect(result.frameRate).toBeCloseTo(59.94, 3);
  });

  it("parses and merges overlapping black and frozen intervals", () => {
    const detected = parseDetectionOutput(`
      [blackdetect] black_start:0 black_end:2.5 black_duration:2.5
      [blackdetect] black_start:2.4 black_end:4 black_duration:1.6
      [freezedetect] lavfi.freezedetect.freeze_start:90
      [freezedetect] lavfi.freezedetect.freeze_duration:4.25
      [freezedetect] lavfi.freezedetect.freeze_end:94.25
      [blackdetect] black_start:200 black_end:250 black_duration:50
    `);
    expect(normalizeDetectedSegments(detected, 220)).toEqual([
      { type: "black", startSeconds: 0, endSeconds: 4 },
      { type: "freeze", startSeconds: 90, endSeconds: 94.25 },
      { type: "black", startSeconds: 200, endSeconds: 220 },
    ]);
  });
});
