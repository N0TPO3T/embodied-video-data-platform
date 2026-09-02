import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import {
  FfmpegTaskBoundaryFrameSampler,
  taskBoundarySamplePlan,
  type TaskBoundaryFrameSample,
  type TaskBoundarySampledFrame,
} from "../src/task-segment/task-boundary-frame-sampler.js";
import {
  QwenTaskBoundaryRefinementProvider,
  type TaskBoundaryRefinementOutput,
  type TaskBoundaryRefinementRequest,
} from "../src/task-segment/task-boundary-refinement.provider.js";
import { boundaryWindowTimestamps } from "../src/task-segment/task-boundary-refinement.policy.js";
import { validateTaskBoundaryRefinementOutput } from "../src/task-segment/task-boundary-refinement.processor.js";

function frame(
  timestampMs: number,
  windows: Array<"start" | "end">,
): TaskBoundarySampledFrame {
  return {
    requestedTimestampsMs: [timestampMs],
    timestampMs,
    windows,
    dataUrl: "data:image/jpeg;base64,AA==",
  };
}

function sample(frames: TaskBoundarySampledFrame[]): TaskBoundaryFrameSample {
  return {
    frames,
    manifest: {
      requestedStartTimestampsMs: frames
        .filter((item) => item.windows.includes("start"))
        .map((item) => item.timestampMs),
      requestedEndTimestampsMs: frames
        .filter((item) => item.windows.includes("end"))
        .map((item) => item.timestampMs),
      frames: frames.map(({ dataUrl: _dataUrl, ...item }) => item),
    },
  };
}

function output(input: {
  start?: number | null;
  end?: number | null;
  startStatus?: "refined" | "unchanged" | "not_observable";
  endStatus?: "refined" | "unchanged" | "not_observable";
  coarseStartMs?: number;
  coarseEndMs?: number;
} = {}): TaskBoundaryRefinementOutput {
  const coarseStartMs = input.coarseStartMs ?? 10_000;
  const coarseEndMs = input.coarseEndMs ?? 20_000;
  const startStatus = input.startStatus ?? "refined";
  const endStatus = input.endStatus ?? "refined";
  return {
    task_index: 1,
    start: {
      coarse_timestamp_ms: coarseStartMs,
      refined_timestamp_ms: input.start === undefined ? 9_000 : input.start,
      status: startStatus,
      evidence_timestamps_ms: [9_000],
      reason_code:
        startStatus === "not_observable"
          ? "INSUFFICIENT_EVIDENCE"
          : "CLEAR_TRANSITION",
    },
    end: {
      coarse_timestamp_ms: coarseEndMs,
      refined_timestamp_ms: input.end === undefined ? 21_000 : input.end,
      status: endStatus,
      evidence_timestamps_ms: [21_000],
      reason_code:
        endStatus === "not_observable"
          ? "INSUFFICIENT_EVIDENCE"
          : "CLEAR_TRANSITION",
    },
  };
}

function validate(
  candidate: TaskBoundaryRefinementOutput,
  frames = [frame(9_000, ["start"]), frame(21_000, ["end"])],
) {
  return validateTaskBoundaryRefinementOutput({
    output: candidate,
    taskIndex: 1,
    coarseStartMs: candidate.start.coarse_timestamp_ms,
    coarseEndMs: candidate.end.coarse_timestamp_ms,
    videoDurationMs: 30_000,
    sample: sample(frames),
  });
}

describe("task boundary local sampling", () => {
  it("uses seven fixed 1-second offsets for an ordinary boundary", () => {
    expect(boundaryWindowTimestamps(10_000, 30_000)).toEqual([
      7_000, 8_000, 9_000, 10_000, 11_000, 12_000, 13_000,
    ]);
  });

  it("clamps, deduplicates and sorts windows at both video edges", () => {
    expect(boundaryWindowTimestamps(500, 10_000)).toEqual([
      0, 500, 1_500, 2_500, 3_500,
    ]);
    expect(boundaryWindowTimestamps(9_500, 10_000)).toEqual([
      6_500, 7_500, 8_500, 9_500, 10_000,
    ]);
  });

  it("deduplicates overlapping start/end requests and records both windows", () => {
    const plan = taskBoundarySamplePlan({
      coarseStartMs: 5_000,
      coarseEndMs: 7_000,
      videoDurationMs: 12_000,
    });
    expect(plan.requests.map((item) => item.timestampMs)).toEqual([
      2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000,
    ]);
    expect(plan.requests.find((item) => item.timestampMs === 5_000)?.windows).toEqual([
      "end",
      "start",
    ]);
  });

  it("stores the FFmpeg-reported actual frame timestamp in the manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "boundary-sampler-test-"));
    let call = 0;
    const runner = {
      run: vi.fn(async (_command: string, args: string[]) => {
        const outputPath = args.at(-1)!;
        await writeFile(outputPath, Buffer.from([call]));
        const timestampSeconds = 1.234 + call;
        call += 1;
        return {
          stdout: "",
          stderr:
            `showinfo pts_time:${timestampSeconds}\n` +
            `showinfo pts_time:${timestampSeconds + 0.033}`,
        };
      }),
    };
    const result = await new FfmpegTaskBoundaryFrameSampler(runner).extract({
      sourcePath: join(directory, "source.mp4"),
      workDirectory: directory,
      coarseStartMs: 1_000,
      coarseEndMs: 1_000,
      videoDurationMs: 10_000,
    });
    expect(result.manifest.frames[0]).toMatchObject({ timestampMs: 1_234 });
    expect(result.manifest.frames.map((item) => item.timestampMs)).toEqual(
      [...result.manifest.frames.map((item) => item.timestampMs)].sort((a, b) => a - b),
    );
  });

  it("records the last decoded source-frame timestamp at the exact video end", async () => {
    const directory = await mkdtemp(join(tmpdir(), "boundary-end-sampler-test-"));
    const runner = {
      run: vi.fn(async (_command: string, args: string[]) => {
        await writeFile(args.at(-1)!, Buffer.from([1]));
        return args.join(" ").includes("reverse")
          ? { stdout: "", stderr: "showinfo pts_time:9.900\nshowinfo pts_time:9.967" }
          : { stdout: "", stderr: "showinfo pts_time:7.000" };
      }),
    };
    const result = await new FfmpegTaskBoundaryFrameSampler(runner).extract({
      sourcePath: join(directory, "source.mp4"),
      workDirectory: directory,
      coarseStartMs: 10_000,
      coarseEndMs: 10_000,
      videoDurationMs: 10_000,
    });
    expect(result.manifest.frames.at(-1)).toMatchObject({ timestampMs: 9_967 });
  });
});

describe("task boundary deterministic validation", () => {
  it("accepts actual sampled timestamps", () => {
    expect(validate(output())).toMatchObject({
      value: {
        refinedStartMs: 9_000,
        refinedEndMs: 21_000,
        selectedStartMs: 9_000,
        selectedEndMs: 21_000,
      },
      issues: [],
    });
  });

  it("rejects a non-sampled timestamp", () => {
    const result = validate(output({ start: 9_500 }));
    expect(result.value).toBeNull();
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("不属于该侧实际采样帧"),
    ]));
  });

  it("rejects a timestamp outside coarse plus or minus three seconds", () => {
    const result = validate(
      output({ start: 6_000 }),
      [frame(6_000, ["start"]), frame(21_000, ["end"])],
    );
    expect(result.value).toBeNull();
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("超过 coarse ±3000ms"),
    ]));
  });

  it("rejects final start greater than or equal to end", () => {
    const candidate = output({
      coarseStartMs: 10_000,
      coarseEndMs: 12_000,
      start: 13_000,
      end: 11_000,
    });
    const result = validateTaskBoundaryRefinementOutput({
      output: candidate,
      taskIndex: 1,
      coarseStartMs: 10_000,
      coarseEndMs: 12_000,
      videoDurationMs: 30_000,
      sample: sample([
        frame(13_000, ["start"]),
        frame(11_000, ["end"]),
      ]),
    });
    expect(result.value).toBeNull();
    expect(result.issues).toContain("精修后的最终 start 必须小于 end");
  });

  it("uses the coarse side when the boundary is not observable", () => {
    const result = validate(output({
      start: null,
      startStatus: "not_observable",
    }));
    expect(result).toMatchObject({
      value: {
        refinedStartMs: null,
        selectedStartMs: 10_000,
        refinedEndMs: 21_000,
      },
      issues: [],
    });
  });
});

describe("Qwen boundary-only provider", () => {
  const request: TaskBoundaryRefinementRequest = {
    submissionId: "SUB-1",
    annotationRunId: "ANR-1",
    taskIndex: 1,
    taskLabel: "将杯子放入沥水架",
    taskVerb: "place",
    coarseStartMs: 10_000,
    coarseEndMs: 20_000,
    videoDurationMs: 30_000,
    previousTask: null,
    nextTask: null,
    frames: [frame(9_000, ["start"]), frame(21_000, ["end"])],
    modelVersion: "qwen3.7-plus",
  };

  it("makes one request and parses the strict boundary-only response", async () => {
    const fetcher = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(output()) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      model: "qwen3.7-plus",
    }), { status: 200 }));
    const provider = new QwenTaskBoundaryRefinementProvider({
      apiKey: "test-key",
      baseUrl: "https://qwen.test/v1",
      timeoutMs: 1_000,
      fetcher: fetcher as unknown as typeof fetch,
    });

    await expect(provider.refine(request)).resolves.toMatchObject({
      output: output(),
      inputTokens: 10,
      outputTokens: 20,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    const format = body.response_format;
    expect(format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "task_boundary_refinement_v1",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["task_index", "start", "end"],
          properties: { task_index: { type: "integer", minimum: 0 } },
        },
      },
    });
    for (const [side, specificReason] of [
      ["start", "ACTION_ALREADY_STARTED"],
      ["end", "RESULT_NOT_VISIBLE"],
    ] as const) {
      const reasons = ["CLEAR_TRANSITION", "GRADUAL_TRANSITION", specificReason, "INSUFFICIENT_EVIDENCE"];
      expect(format.json_schema.schema.properties[side]).toMatchObject({
        additionalProperties: false,
        required: ["coarse_timestamp_ms", "refined_timestamp_ms", "status", "evidence_timestamps_ms", "reason_code"],
        properties: {
          coarse_timestamp_ms: { type: "number" },
          refined_timestamp_ms: { anyOf: [{ type: "number" }, { type: "null" }] },
          status: { type: "string", enum: ["refined", "unchanged", "not_observable"] },
          evidence_timestamps_ms: { type: "array", maxItems: 14, items: { type: "number" } },
          reason_code: { type: "string", enum: reasons },
        },
      });
      for (const reason of reasons) expect(body.messages[0].content).toContain(reason);
    }
    expect(body.messages[0].content).toContain("status=unchanged");
    expect(body.messages[0].content).toContain("status=not_observable");
    expect(body.messages[0].content).toContain("禁止顶层数组");
  });

  it("rejects an attempted task-label modification as an extra output field", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ ...output(), task_label: "篡改后的任务" }),
        },
      }],
    }), { status: 200 }));
    const provider = new QwenTaskBoundaryRefinementProvider({
      apiKey: "test-key",
      baseUrl: "https://qwen.test/v1",
      timeoutMs: 1_000,
      fetcher: fetcher as unknown as typeof fetch,
    });

    await expect(provider.refine(request)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["unchanged", "not_observable"] as const)("accepts %s without requiring a boundary move", async (status) => {
    const candidate = output({ start: null, end: null, startStatus: status, endStatus: status });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(candidate) } }],
    })));
    const provider = new QwenTaskBoundaryRefinementProvider({
      apiKey: "test-key", baseUrl: "https://qwen.test/v1", timeoutMs: 1_000,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(provider.refine(request)).resolves.toMatchObject({ output: candidate });
    expect(validate(candidate).issues).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invented reason", { ...output().start, reason_code: "VISIBLE_ACTION_START" }, "start.reason_code"],
    ["wrong-side reason", { ...output().start, reason_code: "RESULT_NOT_VISIBLE" }, "start.reason_code"],
    ["uppercase status", { ...output().start, status: "REFINED" }, "start.status"],
    ["too many timestamps", { ...output().start, evidence_timestamps_ms: Array(15).fill(9_000) }, "start.evidence_timestamps_ms"],
  ])("retains raw output and issues for %s without another call", async (_label, start, issuePath) => {
    const raw = { ...output(), start };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(raw) } }],
    })));
    const provider = new QwenTaskBoundaryRefinementProvider({
      apiKey: "test-key", baseUrl: "https://qwen.test/v1", timeoutMs: 1_000,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(provider.refine(request)).rejects.toMatchObject({
      failureCode: "REFINEMENT_OUTPUT_SCHEMA_INVALID",
      rawModelOutput: raw,
      validationIssues: expect.arrayContaining([expect.stringContaining(issuePath as string)]),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retains non-JSON model content with a distinct failure code", async () => {
    const raw = '{"task_index":';
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: raw } }],
    })));
    const provider = new QwenTaskBoundaryRefinementProvider({
      apiKey: "test-key", baseUrl: "https://qwen.test/v1", timeoutMs: 1_000,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(provider.refine(request)).rejects.toMatchObject({
      failureCode: "REFINEMENT_OUTPUT_NOT_JSON", rawModelOutput: raw,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects and retains an array-wrapped result instead of silently unwrapping it", async () => {
    const raw = [output()];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(raw) } }],
    })));
    const provider = new QwenTaskBoundaryRefinementProvider({
      apiKey: "test-key", baseUrl: "https://qwen.test/v1", timeoutMs: 1_000,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(provider.refine(request)).rejects.toMatchObject({
      failureCode: "REFINEMENT_OUTPUT_SCHEMA_INVALID", rawModelOutput: raw,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("classifies HTTP failure separately and does not retry", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const provider = new QwenTaskBoundaryRefinementProvider({
      apiKey: "test-key", baseUrl: "https://qwen.test/v1", timeoutMs: 1_000,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(provider.refine(request)).rejects.toMatchObject({
      failureCode: "REFINEMENT_HTTP_FAILED", message: expect.stringContaining("503"),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("classifies transport failure separately and does not retry", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const provider = new QwenTaskBoundaryRefinementProvider({
      apiKey: "test-key", baseUrl: "https://qwen.test/v1", timeoutMs: 1_000,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(provider.refine(request)).rejects.toMatchObject({ failureCode: "REFINEMENT_HTTP_FAILED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
