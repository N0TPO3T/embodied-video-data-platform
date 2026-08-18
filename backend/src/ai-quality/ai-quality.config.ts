import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_AI_QUALITY_CONCURRENCY = 3;

export function videoQualityPromptPath(): string {
  const configured = process.env.VIDEO_QUALITY_PROMPT_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  return fileURLToPath(
    new URL(
      "../../../docs/quality/prompts/qwen-video-ai-quality-prompt-v1/manifest.json",
      import.meta.url,
    ),
  );
}

export function aiQualityConcurrency(value: string | undefined): number {
  const parsed = Number(value?.trim() || DEFAULT_AI_QUALITY_CONCURRENCY);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 32) {
    throw new Error("AI_QUALITY_CONCURRENCY 必须是 1 到 32 之间的整数");
  }
  return parsed;
}

export function aiQualityModelTimeoutMs(value: string | undefined): number {
  const parsed = Number(value?.trim() || 600_000);
  if (!Number.isInteger(parsed) || parsed < 10_000 || parsed > 3_600_000) {
    throw new Error(
      "AI_QUALITY_MODEL_TIMEOUT_MS 必须是 10000 到 3600000 之间的整数",
    );
  }
  return parsed;
}
