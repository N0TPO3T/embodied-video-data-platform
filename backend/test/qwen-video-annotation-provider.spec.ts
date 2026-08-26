import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadVideoAnnotationPrompt } from "../src/video-annotation/prompt-loader.js";
import { QwenVideoAnnotationProvider } from "../src/video-annotation/qwen-video-annotation.provider.js";

function modelOutput() {
  return {
    schema_version: "ego_video_annotation_v1",
    video_id: "video-1",
    video_summary: "拿起杯子并放下。",
    scene: {
      coarse_label: "indoor",
      fine_label: "kitchen",
      confidence: 0.9,
      evidence_timestamps_ms: [0, 750],
    },
    temporal_structure_type: "single_task",
    tasks: [
      {
        start_ms: 0,
        end_ms: 750,
        task_label: "放置杯子",
        task_verb: "pick_and_place",
        task_object: "杯子",
        evidence_level: "direct_visual",
        evidence_timestamps_ms: [0, 250, 750],
        manipulated_objects: ["杯子"],
        tools: [],
        hand_mode: "right",
        interaction_primitives: ["grasp", "place"],
        completion: "complete",
        result_observability: "visible",
        result_status: "success",
        visible_postcondition: "杯子已放在桌面。",
        result_evidence_timestamps_ms: [750],
        failure_recovery: "none_observed",
        uncertainty_reasons: [],
        confidence: 0.9,
      },
    ],
    global_limitations: [],
  };
}

describe("qwen video annotation provider", () => {
  it("loads versioned prompt assets and sends only task-blind annotation context", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v1"),
    );
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(modelOutput()) } }],
          request_id: "request-1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher,
    });

    const result = await provider.annotate({
      videoId: "video-1",
      durationMs: 750,
      frames: [0, 250, 500, 750].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      enabledLabels: [
        { id: "scene-kitchen", name: "厨房", type: "scene" },
      ],
    });

    expect(result.status).toBe("candidate");
    const requestInit = fetcher.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ content: unknown }>;
      temperature: number;
    };
    const userContent = body.messages[1]!.content as Array<{
      type: string;
      text?: string;
    }>;
    const context = JSON.parse(
      userContent.find((part) => part.type === "text")!.text!,
    ) as Record<string, unknown>;
    expect(context).toMatchObject({
      video_id: "video-1",
      annotation_context: {
        enabled_labels: [
          { id: "scene-kitchen", name: "厨房", type: "scene" },
        ],
      },
    });
    expect(context).not.toHaveProperty("task_requirements");
    expect(context).not.toHaveProperty("quality_result");
    expect(body.temperature).toBe(0);
  });

  it("returns a non-authoritative failure artifact instead of throwing", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v1"),
    );
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher: vi.fn().mockRejectedValue(new Error("Bearer sk-secret network error")),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const result = await provider.annotate({
      videoId: "video-1",
      durationMs: 750,
      frames: [0, 250, 500, 750].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      enabledLabels: [],
    });

    expect(result).toMatchObject({ status: "system_failed" });
    if (result.status === "system_failed") {
      expect(result.error).not.toContain("sk-secret");
      expect(result.error).toContain("<redacted>");
    }
  });

  it("limits concurrent shadow model calls across submissions", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v1"),
    );
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolveGate) => {
      releaseFirst = resolveGate;
    });
    let callCount = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) await firstGate;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(modelOutput()) } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      maxConcurrency: 1,
      prompt,
      fetcher,
    });
    const request = {
      videoId: "video-1",
      durationMs: 750,
      frames: [0, 250, 500, 750].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      enabledLabels: [],
    };

    const first = provider.annotate(request);
    const second = provider.annotate(request);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([first, second]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
