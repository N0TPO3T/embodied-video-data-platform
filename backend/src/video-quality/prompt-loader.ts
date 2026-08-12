import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

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

function metadata(document: string, label: string): string {
  const expression = new RegExp(`^${label}：\\s*\`([^\`]+)\`\\s*$`, "mu");
  const matches = [...document.matchAll(new RegExp(expression.source, "gmu"))];
  if (matches.length !== 1 || !matches[0]?.[1]) {
    throw new Error(`质检提示词中的“${label}”必须且只能出现一次`);
  }
  return matches[0][1];
}

function plainMetadata(document: string, label: string): string {
  const expression = new RegExp(`^${label}：\\s*\`?([^\`\\r\\n]+)\`?\\s*$`, "mu");
  const matches = [...document.matchAll(new RegExp(expression.source, "gmu"))];
  if (matches.length !== 1 || !matches[0]?.[1]) {
    throw new Error(`质检提示词中的“${label}”必须且只能出现一次`);
  }
  return matches[0][1].trim();
}

function systemPrompt(document: string): string {
  const match = document.match(
    /^## 系统提示词\s*\r?\n\s*```(?:text)?\s*\r?\n(?<prompt>[\s\S]*?)\r?\n```/mu,
  );
  const prompt = match?.groups?.prompt?.trim();
  if (!prompt) {
    throw new Error("质检提示词缺少“系统提示词”代码块");
  }
  return prompt;
}

function standardOutputExample(document: string): Record<string, unknown> {
  const match = document.match(
    /^## 标准输出结构\s*\r?\n\s*```json\s*\r?\n(?<example>[\s\S]*?)\r?\n```/mu,
  );
  const source = match?.groups?.example?.trim();
  if (!source) {
    throw new Error("质检提示词缺少“标准输出结构”JSON 代码块");
  }

  try {
    const value = JSON.parse(source) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("标准输出结构必须是 JSON 对象");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `质检提示词中的“标准输出结构”不是合法 JSON：${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}

export async function loadVideoQualityPrompt(
  path: string,
): Promise<LoadedVideoQualityPrompt> {
  const document = await readFile(path, "utf8");
  const promptVersion = metadata(document, "提示词版本");
  const ruleVersion = metadata(document, "适配规则");
  const initialModel = metadata(document, "推荐模型");
  const reviewModel = metadata(document, "复核模型");
  const outputSchemaMatch = document.match(
    /"requested_output_schema"\s*:\s*"(?<schema>[^"]+)"/u,
  );
  const outputSchema = outputSchemaMatch?.groups?.schema ?? "";
  const loadedSystemPrompt = systemPrompt(document);

  if (
    promptVersion !== VIDEO_QC_PROMPT_VERSION ||
    ruleVersion !== VIDEO_QC_RULE_VERSION ||
    outputSchema !== VIDEO_QC_RESULT_SCHEMA
  ) {
    throw new Error(
      `不支持的质检提示词版本组合：${promptVersion}/${ruleVersion}/${outputSchema}`,
    );
  }

  const outputExample = standardOutputExample(document);
  if (outputExample.schema_version !== VIDEO_QC_RESULT_SCHEMA) {
    throw new Error("质检提示词的标准输出结构与 requested_output_schema 不一致");
  }

  return {
    systemPrompt: loadedSystemPrompt,
    outputExample,
    promptVersion,
    ruleVersion,
    outputSchema,
    initialModel: plainMetadata(document, "推荐模型"),
    reviewModel: plainMetadata(document, "复核模型"),
    contentSha256: createHash("sha256").update(document).digest("hex"),
  };
}
