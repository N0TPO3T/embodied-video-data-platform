import type { AiQualityPrompt } from "../contracts";

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
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:4000/api/v1";
  return `${base.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
}

async function requestPrompt(init?: RequestInit): Promise<AiQualityPrompt> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(apiUrl("/ai-quality/prompt"), {
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
        : "AI 系统提示词请求失败",
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return (payload as { prompt: AiQualityPrompt }).prompt;
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
