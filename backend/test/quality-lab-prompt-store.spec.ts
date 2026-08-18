import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { QualityLabPromptStore } from "../src/quality-lab/prompt-store.js";
import type { LoadedVideoQualityPrompt } from "../src/video-quality/prompt-loader.js";

const directories: string[] = [];
const committedPrompt: LoadedVideoQualityPrompt = {
  systemPrompt: "video_qc_v1 请用中文输出合法 JSON。",
  outputExample: { schema_version: "video_qc_v1" },
  promptVersion: "qwen_video_qc_prompt_v2",
  ruleVersion: "video_qc_v1",
  outputSchema: "video_qc_v1",
  initialModel: "qwen3.7-plus",
  reviewModel: "qwen3.7-flash",
  contentSha256: "a".repeat(64),
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("quality lab prompt store", () => {
  it("publishes revisions and restores the active prompt after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quality-lab-prompt-"));
    directories.push(directory);
    const persistencePath = join(directory, "prompt.json");
    const store = new QualityLabPromptStore({
      committedPrompt,
      persistencePath,
      now: () => new Date("2026-08-12T09:00:00.000Z"),
    });

    expect(store.getCurrent()).toMatchObject({ revision: 1, initialModel: "qwen3.7-plus" });
    const updated = store.update("video_qc_v1 新规则，请返回 JSON。");
    expect(updated).toMatchObject({ revision: 2, systemPrompt: "video_qc_v1 新规则，请返回 JSON。" });

    const restored = new QualityLabPromptStore({ committedPrompt, persistencePath });
    expect(restored.getCurrent()).toMatchObject({
      revision: 2,
      systemPrompt: "video_qc_v1 新规则，请返回 JSON。",
      reviewModel: "qwen3.7-flash",
    });
  });

  it("rejects empty or contract-breaking prompts", () => {
    const store = new QualityLabPromptStore({ committedPrompt });
    expect(() => store.update(" ")).toThrow("不能为空");
    expect(() => store.update("只输出中文")).toThrow("video_qc_v1");
  });
});
