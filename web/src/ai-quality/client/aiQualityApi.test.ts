import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createQualityRule,
  getLabelSet,
  getAiQualityPrompt,
  getQualityRule,
  updateAiQualityPrompt,
  updateQualityLabel,
} from "./aiQualityApi";

describe("AI quality prompt API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads and updates the administrator prompt with credentials", async () => {
    const prompt = {
      id: "VQP-1",
      revision: 1,
      systemPrompt: "系统提示词",
      contentSha256: "a".repeat(64),
      promptVersion: "qwen_video_qc_prompt_v1",
      ruleVersion: "video_qc_v1",
      outputSchema: "video_qc_result_v1",
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      createdByName: "管理员",
      createdAt: 1,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ prompt }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ prompt: { ...prompt, revision: 2 } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(getAiQualityPrompt()).resolves.toEqual(prompt);
    await expect(updateAiQualityPrompt("新提示词")).resolves.toMatchObject({
      revision: 2,
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4000/api/v1/ai-quality/prompt",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ systemPrompt: "新提示词" }),
      }),
    );
  });

  it("loads and publishes quality rule versions with credentials", async () => {
    const rule = {
      id: "QRV-1",
      revision: 1,
      version: "RULE-2026-08",
      passThreshold: 60,
      description: "八月具身视频质量准入规则",
      active: true,
      createdByAccountId: "U-ADMIN",
      createdByName: "管理员",
      createdAt: 1,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rule }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rule: {
              ...rule,
              revision: 2,
              version: "RULE-2026-09",
              passThreshold: 65,
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(getQualityRule()).resolves.toEqual(rule);
    await expect(
      createQualityRule({
        version: "RULE-2026-09",
        passThreshold: 65,
        description: "九月质量规则",
      }),
    ).resolves.toMatchObject({
      revision: 2,
      version: "RULE-2026-09",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4000/api/v1/ai-quality/quality-rule",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          version: "RULE-2026-09",
          passThreshold: 65,
          description: "九月质量规则",
        }),
      }),
    );
  });

  it("loads and updates label set versions with credentials", async () => {
    const labelSet = {
      id: "LSV-1",
      revision: 1,
      version: "LABELS-2026-08",
      labels: [
        {
          id: "SCENE-001",
          name: "家庭厨房",
          type: "scene" as const,
          associationCount: 186,
          enabled: true,
        },
      ],
      active: true,
      createdByAccountId: "U-ADMIN",
      createdByName: "管理员",
      createdAt: 1,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ labelSet }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ labelSet: { ...labelSet, revision: 2 } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(getLabelSet()).resolves.toEqual(labelSet);
    await expect(
      updateQualityLabel({
        id: "SCENE-001",
        nextId: "SCENE-101",
        name: "家庭烹饪",
        enabled: false,
      }),
    ).resolves.toMatchObject({ revision: 2 });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4000/api/v1/ai-quality/labels/SCENE-001",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          id: "SCENE-001",
          nextId: "SCENE-101",
          name: "家庭烹饪",
          enabled: false,
        }),
      }),
    );
  });
});
