import { describe, expect, it, vi } from "vitest";

import type { LoadedVideoQualityPrompt } from "../src/video-quality/prompt-loader.js";
import {
  BailianRequestError,
  QwenVideoQualityProvider,
} from "../src/video-quality/qwen-video-quality.provider.js";
import type {
  DimensionKey,
  RawVideoQcResultV1,
  VideoQcInputV1,
} from "../src/video-quality/video-quality.types.js";

const keys: DimensionKey[] = [
  "first_person_and_composition",
  "hand_forearm_object_integrity",
  "frame_and_video_quality",
  "task_authenticity_completeness",
  "task_value_uniqueness",
];

function rawResult(): RawVideoQcResultV1 {
  return {
    schema_version: "video_qc_v1",
    rule_version: "video_qc_v1",
    prompt_version: "qwen_video_qc_prompt_v3",
    task_id: "LAB-1",
    evaluation_status: "completed",
    input_status: {
      is_complete: true,
      missing_required_inputs: [],
      conflicts: [],
    },
    task_summary: "清洁物体",
    overall_result: {
      raw_total_score: 80,
      final_score: 80,
      summary: "质量稳定",
    },
    hard_reject: { triggered: false, reasons: [], candidates: [] },
    dimensions: Object.fromEntries(
      (["D1", "D2", "D3", "D4", "D5"] as const).map((key) => [
        key,
        {
          coefficient: 0.8,
          score: 16,
          confidence: 0.9,
          metrics: {},
          issues: [],
        },
      ]),
    ) as unknown as RawVideoQcResultV1["dimensions"],
    review: { review_required: false, review_reasons: [] },
    duration_result: {
      analysis_duration_ms: 60_000,
      invalid_duration_ms: 0,
      effective_duration_ms: 60_000,
      effective_duration_ratio: 1,
      invalid_segments: [],
      necessary_wait_segments: [],
    },
    recommendations: [],
  };
}

function response(
  content: string,
  status = 200,
  requestId = "req-123",
): Response {
  return new Response(
    status >= 200 && status < 300
      ? JSON.stringify({
          choices: [{ message: { content } }],
          request_id: requestId,
        })
      : content,
    {
      status,
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
      },
    },
  );
}

const prompt: LoadedVideoQualityPrompt = {
  systemPrompt: "system prompt",
  outputExample: rawResult() as unknown as Record<string, unknown>,
  promptVersion: "qwen_video_qc_prompt_v3",
  ruleVersion: "video_qc_v1",
  outputSchema: "video_qc_v1",
  initialModel: "qwen3.7-plus",
  reviewModel: "qwen3.7-flash",
  contentSha256: "c".repeat(64),
};

const input = {
  schema_version: "video_qc_input_v1",
  video_id: "LAB-1",
} as VideoQcInputV1;

function frames() {
  return [
    { timestampMs: 0, dataUrl: "data:image/jpeg;base64,AA==" },
    { timestampMs: 5_000, dataUrl: "data:image/jpeg;base64,AQ==" },
    { timestampMs: 10_000, dataUrl: "data:image/jpeg;base64,Ag==" },
    { timestampMs: 15_000, dataUrl: "data:image/jpeg;base64,Aw==" },
  ];
}

function provider(fetcher: typeof fetch) {
  const diagnostics: import("../src/video-quality/video-quality.types.js").BailianCallDiagnostic[] = [];
  return new QwenVideoQualityProvider({
    config: {
      apiKey: "secret-test-key",
      baseUrl: "https://workspace.example.com/compatible-mode/v1/",
      initialModel: prompt.initialModel,
      reviewModel: prompt.reviewModel,
      timeoutMs: 10_000,
    },
    prompt,
    fetcher,
    sleep: async () => undefined,
    diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
  });
}

function providerWithDiagnostics(fetcher: typeof fetch) {
  const diagnostics: import("../src/video-quality/video-quality.types.js").BailianCallDiagnostic[] = [];
  const instance = new QwenVideoQualityProvider({
    config: {
      apiKey: "secret-test-key",
      baseUrl: "https://workspace.example.com/compatible-mode/v1/",
      initialModel: prompt.initialModel,
      reviewModel: prompt.reviewModel,
      timeoutMs: 10_000,
    },
    prompt,
    fetcher,
    sleep: async () => undefined,
    diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { instance, diagnostics };
}

describe("Qwen video quality provider", () => {
  it("calls Qwen3.7 Plus for initial review with frame-array video input", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(JSON.stringify(rawResult())),
    );

    const result = await provider(fetcher).analyze({
      input,
      frames: frames(),
    });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    expect(url).toBe(
      "https://workspace.example.com/compatible-mode/v1/chat/completions",
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-test-key",
    );
    expect(body.model).toBe("qwen3.7-plus");
    expect(body.enable_thinking).toBe(false);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content[0]).toEqual({
      type: "video",
      video: [
        "data:image/jpeg;base64,AA==",
        "data:image/jpeg;base64,AQ==",
        "data:image/jpeg;base64,Ag==",
        "data:image/jpeg;base64,Aw==",
      ],
    });
    const textInput = JSON.parse(body.messages[1].content[1].text) as Record<
      string,
      any
    >;
    expect(textInput.output_contract.hard_reject.triggered).toBe(false);
    expect(textInput.output_requirements.join(" ")).toContain("不得改名或遗漏字段");
    expect(textInput.output_requirements.join(" ")).not.toContain("简体中文");
    expect(result.raw.overall_result.final_score).toBe(80);
    expect(result.metadata.requestId).toBe("req-123");
    expect(result.metadata.stage).toBe("initial");
    expect(JSON.stringify(result)).not.toContain("secret-test-key");
  });

  it("retries retryable responses but not authentication errors", async () => {
    const retryingFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('{"code":"Throttled"}', 429))
      .mockResolvedValueOnce(response(JSON.stringify(rawResult())));

    await provider(retryingFetch).analyze({ input, frames: frames() });
    expect(retryingFetch).toHaveBeenCalledTimes(2);

    const authFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response('{"message":"bad sk-test-secret"}', 401));
    let caught: unknown;
    try {
      await provider(authFetch).analyze({ input, frames: frames() });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BailianRequestError);
    expect((caught as Error).message).not.toContain("secret-test-key");
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid video frame count before calling Bailian", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      provider(fetcher).analyze({ input, frames: frames().slice(0, 3) }),
    ).rejects.toThrow("需要 4–8000 帧，实际 3 帧");

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces a redacted provider error code and actionable message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        JSON.stringify({
          error: {
            code: "invalid_parameter_error",
            message:
              "The video modality input does not meet the requirements because: the range of sequence images should be (4, 8000).",
          },
        }),
        400,
        "req-invalid-video",
      ),
    );
    const { instance, diagnostics } = providerWithDiagnostics(fetcher);

    await expect(
      instance.analyze({ input, frames: frames() }),
    ).rejects.toThrow("视频序列帧数量不符合要求，需要 4–8000 帧");
    expect(diagnostics).toMatchObject([
      {
        outcome: "http_error",
        httpStatus: 400,
        requestId: "req-invalid-video",
        errorCode: "invalid_parameter_error",
        errorMessage: expect.stringContaining(
          "视频序列帧数量不符合要求，需要 4–8000 帧",
        ),
      },
    ]);
  });

  it("extracts fenced JSON and repairs one invalid schema response", async () => {
    const fencedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      response(`\`\`\`json\n${JSON.stringify(rawResult())}\n\`\`\``),
    );
    expect(
      (await provider(fencedFetch).analyze({ input, frames: frames() })).raw
        .schema_version,
    ).toBe("video_qc_v1");

    const repairFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("{}"))
      .mockResolvedValueOnce(response(JSON.stringify(rawResult())));
    const repaired = await provider(repairFetch).analyze({
      input,
      frames: frames(),
    });
    expect(repaired.raw.overall_result.final_score).toBe(80);
    expect(repairFetch).toHaveBeenCalledTimes(2);
    const repairBody = JSON.parse(
      String(repairFetch.mock.calls[1]?.[1]?.body),
    ) as Record<string, any>;
    expect(repairBody.model).toBe("qwen3.7-plus");
    expect(repairBody.messages.at(-1).content[0].text).toContain(
      "video_qc_v1",
    );
    expect(repairBody.messages.at(-1).content[0].text).toContain(
      '"hard_reject"',
    );
  });

  it("accepts structurally valid English content without a repair call", async () => {
    const english = rawResult();
    english.task_summary = "Clean an object";
    english.overall_result.summary = "The video quality is stable";
    english.recommendations = ["Keep the camera steady"];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(JSON.stringify(english), 200, "req-en"),
    );

    const result = await provider(fetcher).analyze({
      input,
      frames: frames(),
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.raw.overall_result.summary).toBe("The video quality is stable");
  });

  it("accepts a v2 result that does not echo rule and prompt versions", async () => {
    const minimal = rawResult() as Record<string, unknown>;
    delete minimal.rule_version;
    delete minimal.prompt_version;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(JSON.stringify(minimal), 200, "req-no-versions"),
    );

    const result = await provider(fetcher).analyze({
      input,
      frames: frames(),
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.raw.schema_version).toBe("video_qc_v1");
  });

  it("preserves model-provided dimension metrics", async () => {
    const resultWithMetrics = rawResult();
    for (const dimension of Object.values(resultWithMetrics.dimensions)) {
      dimension.metrics = { C_view: 0.9 };
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(JSON.stringify(resultWithMetrics), 200, "req-trace"),
    );

    const result = await provider(fetcher).analyze({
      input,
      frames: frames(),
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const dimension of Object.values(result.raw.dimensions)) {
      expect(dimension.metrics.C_view).toBe(0.9);
    }
  });

  it("uses Qwen3.7 Flash only for review input and preserves initial observations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(JSON.stringify(rawResult()), 200, "req-plus"),
    );

    const result = await provider(fetcher).review({
      input,
      initialResult: rawResult(),
      frames: frames(),
      reviewReasons: ["low confidence"],
    });

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<
      string,
      any
    >;
    expect(body.model).toBe("qwen3.7-flash");
    expect(body.messages[1].content[1].text).toContain("initial_result");
    expect(body.messages[1].content[1].text).toContain("low confidence");
    expect(body.messages[1].content[1].text).toContain("output_contract");
    expect(result.metadata.stage).toBe("review");
  });

  it("emits task-scoped diagnostics for success and HTTP retries", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("throttled", 429, "req-rate"))
      .mockResolvedValueOnce(response(JSON.stringify(rawResult()), 200, "req-ok"));
    const { instance, diagnostics } = providerWithDiagnostics(fetcher);

    await instance.analyze({ input, frames: frames() });

    expect(diagnostics).toMatchObject([
      {
        taskId: "LAB-1",
        modelStage: "initial",
        operation: "analysis",
        attempt: 1,
        outcome: "http_error",
        httpStatus: 429,
        requestId: "req-rate",
        retryable: true,
      },
      {
        taskId: "LAB-1",
        modelStage: "initial",
        operation: "analysis",
        attempt: 2,
        outcome: "success",
        httpStatus: 200,
        requestId: "req-ok",
      },
    ]);
  });

  it("records redacted network causes for every failed attempt", async () => {
    const networkError = new TypeError("fetch failed Bearer secret-test-key", {
      cause: Object.assign(new Error("connect /private/tmp/socket"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    });
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);
    const { instance, diagnostics } = providerWithDiagnostics(fetcher);

    await expect(
      instance.analyze({ input, frames: frames() }),
    ).rejects.toThrow(
      "TypeError",
    );
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics[2]).toMatchObject({
      taskId: "LAB-1",
      outcome: "network_error",
      errorName: "TypeError",
      errorCode: "UND_ERR_CONNECT_TIMEOUT",
      retryable: false,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("secret-test-key");
    expect(JSON.stringify(diagnostics)).not.toContain("/private/tmp");
  });
});
