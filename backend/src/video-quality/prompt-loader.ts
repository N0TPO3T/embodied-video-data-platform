import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  VIDEO_QC_PROMPT_VERSION,
  VIDEO_QC_RESULT_SCHEMA,
  VIDEO_QC_RULE_VERSION,
} from "./video-quality.types.js";

export type LoadedVideoQualityPrompt = {
  systemPrompt: string;
  outputExample: Record<string, unknown>;
  promptVersion: string;
  ruleVersion: string;
  outputSchema: string;
  initialModel: string;
  reviewModel: string;
  contentSha256: string;
};

type PromptManifest = {
  promptVersion: string;
  ruleVersion: string;
  outputSchema: string;
  initialModel: string;
  reviewModel: string;
  files: {
    systemPrompt: string;
    outputExample: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`质检提示词 manifest 缺少或无效：${label}`);
  }
  return value;
}

function requiredFileReference(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`质检提示词 manifest 缺少文件引用：${label}`);
  }
  return value;
}

async function manifestPath(path: string): Promise<string> {
  const info = await stat(path);
  if (info.isDirectory()) return join(path, "manifest.json");
  return path;
}

export async function loadVideoQualityPrompt(
  path: string,
): Promise<LoadedVideoQualityPrompt> {
  const manifestFile = await manifestPath(path);
  let document: unknown;
  try {
    document = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (error) {
    throw new Error(
      `质检提示词 manifest 不是合法 JSON：${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
  if (!isRecord(document)) {
    throw new Error("质检提示词 manifest 必须是 JSON 对象");
  }
  const files = document.files;
  if (!isRecord(files)) {
    throw new Error("质检提示词 manifest 缺少 files 对象");
  }

  const promptVersion = requiredString(document.promptVersion, "promptVersion");
  const ruleVersion = requiredString(document.ruleVersion, "ruleVersion");
  const outputSchema = requiredString(document.outputSchema, "outputSchema");
  const initialModel = requiredString(document.initialModel, "initialModel");
  const reviewModel = requiredString(document.reviewModel, "reviewModel");
  const systemPromptFile = requiredFileReference(
    files.systemPrompt,
    "systemPrompt",
  );
  const outputExampleFile = requiredFileReference(
    files.outputExample,
    "outputExample",
  );

  if (
    promptVersion !== VIDEO_QC_PROMPT_VERSION ||
    ruleVersion !== VIDEO_QC_RULE_VERSION ||
    outputSchema !== VIDEO_QC_RESULT_SCHEMA
  ) {
    throw new Error(
      `不支持的质检提示词版本组合：${promptVersion}/${ruleVersion}/${outputSchema}`,
    );
  }

  const baseDirectory = dirname(manifestFile);
  let systemPrompt: string;
  try {
    systemPrompt = (await readFile(resolve(baseDirectory, systemPromptFile), "utf8")).trim();
  } catch (error) {
    throw new Error(
      `系统提示词正文（system.txt）读取失败：${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
  if (!systemPrompt) {
    throw new Error("系统提示词正文为空，请检查 system.txt");
  }

  let outputExample: Record<string, unknown>;
  let outputExampleSource: string;
  try {
    outputExampleSource = await readFile(
      resolve(baseDirectory, outputExampleFile),
      "utf8",
    );
  } catch (error) {
    throw new Error(
      `质检提示词的标准输出结构读取失败：${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
  try {
    const parsed = JSON.parse(outputExampleSource) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("标准输出结构必须是 JSON 对象");
    }
    outputExample = parsed;
  } catch (error) {
    throw new Error(
      `质检提示词的标准输出结构不是合法 JSON：${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
  if (outputExample.schema_version !== VIDEO_QC_RESULT_SCHEMA) {
    throw new Error("质检提示词的标准输出结构与 requested_output_schema 不一致");
  }

  return {
    systemPrompt,
    outputExample,
    promptVersion,
    ruleVersion,
    outputSchema,
    initialModel,
    reviewModel,
    contentSha256: createHash("sha256")
      .update(systemPrompt, "utf8")
      .digest("hex"),
  };
}
