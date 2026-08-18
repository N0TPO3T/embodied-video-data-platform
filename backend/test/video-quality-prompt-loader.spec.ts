import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadVideoQualityPrompt } from "../src/video-quality/prompt-loader.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const VALID_MANIFEST = {
  promptVersion: "qwen_video_qc_prompt_v2",
  ruleVersion: "video_qc_v1",
  outputSchema: "video_qc_v1",
  initialModel: "qwen3.7-plus",
  reviewModel: "qwen3.7-flash",
  files: {
    systemPrompt: "system.txt",
    outputExample: "output-example.json",
  },
};

const VALID_OUTPUT_EXAMPLE = {
  schema_version: "video_qc_v1",
  rule_version: "video_qc_v1",
  prompt_version: "qwen_video_qc_prompt_v2",
  task_id: "",
  evaluation_status: "completed",
  hard_reject: { triggered: false, reasons: [], candidates: [] },
  dimensions: { D5: { score: 0, coefficient: 0 } },
};

async function makePromptDirectory(
  files: {
    manifest?: unknown;
    systemPrompt?: string;
    outputExample?: unknown;
  } = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "evdp-prompt-test-"));
  temporaryDirectories.push(directory);
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify(files.manifest ?? VALID_MANIFEST, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(directory, "system.txt"),
    files.systemPrompt ?? "system prompt",
    "utf8",
  );
  await writeFile(
    join(directory, "output-example.json"),
    `${JSON.stringify(files.outputExample ?? VALID_OUTPUT_EXAMPLE, null, 2)}\n`,
    "utf8",
  );
  return directory;
}

describe("video quality prompt loader", () => {
  it("loads the committed V1 prompt directory from its manifest", async () => {
    const prompt = await loadVideoQualityPrompt(
      resolve(
        process.cwd(),
        "../docs/quality/prompts/qwen-video-ai-quality-prompt-v1/manifest.json",
      ),
    );

    expect(prompt.promptVersion).toBe("qwen_video_qc_prompt_v2");
    expect(prompt.ruleVersion).toBe("video_qc_v1");
    expect(prompt.outputSchema).toBe("video_qc_v1");
    expect(prompt.initialModel).toBe("qwen3.7-plus");
    expect(prompt.reviewModel).toBe("qwen3.7-flash");
    expect(prompt.systemPrompt).toContain("具身视频数据质量评估器");
    expect(prompt.systemPrompt).toContain("简体中文");
    expect(prompt.systemPrompt).not.toContain("## 用户输入模板");
    expect(prompt.outputExample.schema_version).toBe("video_qc_v1");
    expect(prompt.outputExample).toHaveProperty("hard_reject.triggered", false);
    expect(prompt.outputExample).toHaveProperty("dimensions.D5");
    expect(prompt.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("accepts a directory path and resolves its manifest.json", async () => {
    const directory = await makePromptDirectory();
    const prompt = await loadVideoQualityPrompt(directory);
    expect(prompt.promptVersion).toBe("qwen_video_qc_prompt_v2");
    expect(prompt.systemPrompt).toContain("system prompt");
  });

  it("rejects a manifest that is not valid JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "evdp-prompt-test-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "manifest.json"), "not json", "utf8");
    await expect(loadVideoQualityPrompt(directory)).rejects.toThrow(
      "manifest 不是合法 JSON",
    );
  });

  it("rejects a manifest missing required metadata", async () => {
    const directory = await makePromptDirectory({
      manifest: {
        ...VALID_MANIFEST,
        promptVersion: undefined,
      },
    });
    await expect(loadVideoQualityPrompt(directory)).rejects.toThrow(
      "缺少或无效：promptVersion",
    );
  });

  it("rejects unsupported prompt and rule versions", async () => {
    const directory = await makePromptDirectory({
      manifest: {
        ...VALID_MANIFEST,
        promptVersion: "qwen_video_qc_prompt_v3",
        ruleVersion: "video_qc_v2",
      },
      systemPrompt: "system prompt",
      outputExample: { ...VALID_OUTPUT_EXAMPLE, schema_version: "video_qc_v2" },
    });
    await expect(loadVideoQualityPrompt(directory)).rejects.toThrow("不支持");
  });

  it("rejects a manifest referencing a missing system prompt file", async () => {
    const directory = await makePromptDirectory({
      manifest: {
        ...VALID_MANIFEST,
        files: {
          systemPrompt: "missing.txt",
          outputExample: "output-example.json",
        },
      },
      outputExample: VALID_OUTPUT_EXAMPLE,
    });
    await expect(loadVideoQualityPrompt(directory)).rejects.toThrow(
      "系统提示词正文",
    );
  });

  it("rejects a prompt without a standard output contract", async () => {
    const directory = await makePromptDirectory({
      manifest: {
        ...VALID_MANIFEST,
        files: {
          systemPrompt: "system.txt",
          outputExample: "missing.json",
        },
      },
      systemPrompt: "system prompt",
    });
    await expect(loadVideoQualityPrompt(directory)).rejects.toThrow(
      "标准输出结构",
    );
  });

  it("rejects an output contract whose schema does not match", async () => {
    const directory = await makePromptDirectory({
      systemPrompt: "system prompt",
      outputExample: { ...VALID_OUTPUT_EXAMPLE, schema_version: "video_qc_result_v2" },
    });
    await expect(loadVideoQualityPrompt(directory)).rejects.toThrow(
      "与 requested_output_schema 不一致",
    );
  });

  it("rejects an empty system prompt body", async () => {
    const directory = await makePromptDirectory({
      systemPrompt: "   ",
      outputExample: VALID_OUTPUT_EXAMPLE,
    });
    await expect(loadVideoQualityPrompt(directory)).rejects.toThrow(
      "系统提示词正文为空",
    );
  });
});
