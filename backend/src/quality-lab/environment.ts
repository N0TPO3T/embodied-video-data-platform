import { resolve } from "node:path";

export type RawQualityLabEnvironment = Record<string, string | undefined>;

export type QualityLabEnvironment = {
  host: string;
  port: number;
  maxUploadBytes: number;
  modelTimeoutMs: number;
  promptPath: string;
  qwenApiKey?: string;
  qwenBaseUrl: string;
  initialModel: string;
  reviewModel: string;
  modelConfigured: boolean;
  historyPath?: string;
  historyRetentionDays: number;
};

function integer(
  source: RawQualityLabEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(source[name] ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return parsed;
}

export function parseQualityLabEnvironment(
  source: RawQualityLabEnvironment,
): QualityLabEnvironment {
  const qwenApiKey = source.QWEN_API_KEY?.trim() || undefined;
  const qwenBaseUrl = (
    source.QWEN_BASE_URL ??
    "https://dashscope.aliyuncs.com/compatible-mode/v1"
  ).trim();
  const url = new URL(qwenBaseUrl);
  if (url.protocol !== "https:") {
    throw new Error("QWEN_BASE_URL 必须使用 HTTPS");
  }
  const host = (source.QUALITY_LAB_HOST ?? "127.0.0.1").trim();
  if (host !== "127.0.0.1" && host !== "0.0.0.0") {
    throw new Error("QUALITY_LAB_HOST 只能是 127.0.0.1 或 0.0.0.0");
  }
  return {
    host,
    port: integer(source, "QUALITY_LAB_PORT", 4010, 1, 65_535),
    maxUploadBytes: integer(
      source,
      "QUALITY_LAB_MAX_UPLOAD_BYTES",
      1_073_741_824,
      1,
      2_147_483_648,
    ),
    modelTimeoutMs: integer(
      source,
      "QUALITY_LAB_MODEL_TIMEOUT_MS",
      600_000,
      1_000,
      3_600_000,
    ),
    promptPath:
      source.VIDEO_QUALITY_PROMPT_PATH?.trim() ||
      resolve(
        process.cwd(),
        "../docs/quality/qwen-video-ai-quality-prompt-v1.md",
      ),
    qwenApiKey,
    qwenBaseUrl: url.toString().replace(/\/$/u, ""),
    initialModel:
      source.VIDEO_QUALITY_INITIAL_MODEL?.trim() ||
      "qwen3.7-plus",
    reviewModel:
      source.VIDEO_QUALITY_REVIEW_MODEL?.trim() ||
      "qwen3.7-flash",
    modelConfigured: Boolean(qwenApiKey),
    historyPath: source.QUALITY_LAB_HISTORY_PATH?.trim() || undefined,
    historyRetentionDays: integer(
      source,
      "QUALITY_LAB_HISTORY_RETENTION_DAYS",
      30,
      1,
      365,
    ),
  };
}
