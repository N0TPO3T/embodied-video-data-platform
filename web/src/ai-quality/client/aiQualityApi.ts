import { resolveApiBaseUrl } from "../../lib/api-base";
import type {
  AiQualityPrompt,
  CreateLabelInput,
  CreateQualityRuleInput,
  LabelSet,
  PublishScarcityConfigInput,
  QualityRule,
  ScarcityConfig,
  UpdateLabelInput,
} from "../contracts";

export class AiQualityApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AiQualityApiError";
  }
}

function apiUrl(path: string): string {
  const base = resolveApiBaseUrl(
    process.env.NEXT_PUBLIC_API_BASE_URL,
    "http://localhost:4000/api/v1",
  );
  return `${base.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
}

async function requestJson<T>(
  path: string,
  failureMessage: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = payload as { error?: unknown; code?: unknown };
    throw new AiQualityApiError(
      response.status,
      typeof error.error === "string"
        ? error.error
        : failureMessage,
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

async function requestPrompt(init?: RequestInit): Promise<AiQualityPrompt> {
  const payload = await requestJson<{ prompt: AiQualityPrompt }>(
    "/ai-quality/prompt",
    "AI 系统提示词请求失败",
    init,
  );
  return payload.prompt;
}

export function getAiQualityPrompt(): Promise<AiQualityPrompt> {
  return requestPrompt();
}

export function updateAiQualityPrompt(
  systemPrompt: string,
): Promise<AiQualityPrompt> {
  return requestPrompt({
    method: "PUT",
    body: JSON.stringify({ systemPrompt }),
  });
}

export async function getQualityRule(): Promise<QualityRule> {
  const payload = await requestJson<{ rule: QualityRule }>(
    "/ai-quality/quality-rule",
    "质量规则请求失败",
  );
  return payload.rule;
}

export async function createQualityRule(
  input: CreateQualityRuleInput,
): Promise<QualityRule> {
  const payload = await requestJson<{ rule: QualityRule }>(
    "/ai-quality/quality-rule",
    "质量规则保存失败",
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return payload.rule;
}

export async function getLabelSet(): Promise<LabelSet> {
  const payload = await requestJson<{ labelSet: LabelSet }>(
    "/ai-quality/label-set",
    "标签体系请求失败",
  );
  return payload.labelSet;
}

export async function updateQualityLabel(
  input: UpdateLabelInput,
): Promise<LabelSet> {
  const payload = await requestJson<{ labelSet: LabelSet }>(
    `/ai-quality/labels/${encodeURIComponent(input.id)}`,
    "标签保存失败",
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return payload.labelSet;
}

export async function createQualityLabel(
  input: CreateLabelInput,
): Promise<LabelSet> {
  const payload = await requestJson<{ labelSet: LabelSet }>(
    "/ai-quality/labels",
    "标签新增失败",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return payload.labelSet;
}

export async function deleteQualityLabel(id: string): Promise<LabelSet> {
  const payload = await requestJson<{ labelSet: LabelSet }>(
    `/ai-quality/labels/${encodeURIComponent(id)}`,
    "标签删除失败",
    { method: "DELETE" },
  );
  return payload.labelSet;
}

export async function getScarcityConfig(): Promise<ScarcityConfig> {
  const payload = await requestJson<{ scarcityConfig: ScarcityConfig }>(
    "/ai-quality/scarcity-config",
    "稀缺奖励配置请求失败",
  );
  return payload.scarcityConfig;
}

export async function publishScarcityConfig(
  input: PublishScarcityConfigInput,
): Promise<ScarcityConfig> {
  const payload = await requestJson<{ scarcityConfig: ScarcityConfig }>(
    "/ai-quality/scarcity-config",
    "稀缺奖励配置保存失败",
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return payload.scarcityConfig;
}
