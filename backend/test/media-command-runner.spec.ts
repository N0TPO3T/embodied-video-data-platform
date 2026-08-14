import { EventEmitter } from "node:events";

import {
  normalizeDetectedSegments,
  parseDetectionOutput,
  parseProbeOutput,
  runMediaCommand,
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

  it("terminates a command that never closes and can run the next command", async () => {
    vi.useFakeTimers();
    try {
      const hung = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn().mockReturnValue(true),
      });
      const succeeded = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn().mockReturnValue(true),
      });
      const spawnProcess = vi
        .fn()
        .mockReturnValueOnce(hung)
        .mockReturnValueOnce(succeeded);
      const first = runMediaCommand("ffmpeg", ["-version"], {
        timeoutMs: 20,
        killGraceMs: 10,
        spawnProcess: spawnProcess as never,
      });
      const firstRejected = expect(first).rejects.toThrow(
        "ffmpeg timed out after 20 ms",
      );

      await vi.advanceTimersByTimeAsync(20);
      expect(hung.kill).toHaveBeenCalledWith("SIGTERM");
      expect(hung.kill).not.toHaveBeenCalledWith("SIGKILL");
      await vi.advanceTimersByTimeAsync(10);
      await firstRejected;
      expect(hung.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
      expect(hung.listenerCount("close")).toBe(0);
      expect(hung.listenerCount("error")).toBe(0);
      expect(hung.stdout.listenerCount("data")).toBe(0);
      expect(hung.stderr.listenerCount("data")).toBe(0);

      const second = runMediaCommand("ffprobe", ["-version"], {
        timeoutMs: 20,
        killGraceMs: 10,
        spawnProcess: spawnProcess as never,
      });
      succeeded.stdout.emit("data", Buffer.from("ok", "utf8"));
      succeeded.emit("close", 0);
      await expect(second).resolves.toEqual({ stdout: "ok", stderr: "" });
      expect(succeeded.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
