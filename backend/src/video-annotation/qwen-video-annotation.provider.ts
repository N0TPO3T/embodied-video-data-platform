import { ZodError } from "zod";

import type { TimestampedFrame } from "../video-quality/video-quality.types.js";
import type { LoadedVideoAnnotationPrompt } from "./prompt-loader.js";
import {
  VIDEO_ANNOTATION_POLICY_VERSION,
  VIDEO_ANNOTATION_SCHEMA_VERSION,
  normalizeVideoAnnotation,
  parseRawVideoAnnotation,
  type VideoAnnotationCandidate,
  type VideoAnnotationCandidateSuccess,
} from "./video-annotation.js";

type Fetcher = typeof fetch;
const MAX_ANNOTATION_FRAME_COUNT = 80;

type ModelUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type ModelCallResult = {
  content: string;
  requestId: string | null;
  responseModel: string | null;
  usage?: ModelUsage;
};

type ChatContentPart =
  | { type: "video"; video: string[] }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "text"; text: string };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

export type VideoAnnotationRequest = {
  videoId: string;
  durationMs: number;
  frames: TimestampedFrame[];
  enabledLabels: Array<{
    id: string;
    name: string;
    type: "scene" | "action" | "object";
  }>;
};

export interface VideoAnnotationProvider {
  annotate(
    request: VideoAnnotationRequest,
    signal?: AbortSignal,
  ): Promise<VideoAnnotationCandidate>;
}

export class VideoAnnotationProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function annotationFrames(frames: TimestampedFrame[]): TimestampedFrame[] {
  if (frames.length <= MAX_ANNOTATION_FRAME_COUNT) return frames;
  const selected = new Set<number>();
  for (let index = 0; index < MAX_ANNOTATION_FRAME_COUNT; index += 1) {
    selected.add(
      Math.round((index * (frames.length - 1)) / (MAX_ANNOTATION_FRAME_COUNT - 1)),
    );
  }
  return [...selected].map((index) => frames[index]!);
}

function safeError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
    .replace(/sk-(?:ws-)?[A-Za-z0-9._-]+/gu, "<redacted>")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gu, "<data-url-redacted>")
    .slice(0, 1_500);
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function responseRequestId(response: Response, document?: unknown): string | null {
  const header = response.headers.get("x-request-id");
  if (header) return header;
  if (
    document &&
    typeof document === "object" &&
    "request_id" in document &&
    typeof document.request_id === "string"
  ) {
    return document.request_id;
  }
  return null;
}

function responseContent(document: unknown): string {
  if (!document || typeof document !== "object" || !("choices" in document)) {
    throw new Error("百炼候选标注响应缺少 choices");
  }
  const choices = document.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("百炼候选标注响应 choices 为空");
  }
  const message = choices[0];
  if (
    !message ||
    typeof message !== "object" ||
    !("message" in message) ||
    !message.message ||
    typeof message.message !== "object" ||
    !("content" in message.message)
  ) {
    throw new Error("百炼候选标注响应缺少 message.content");
  }
  const content = message.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) =>
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("");
  }
  throw new Error("百炼候选标注响应 content 类型无效");
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function responseModel(document: unknown): string | null {
  return document &&
    typeof document === "object" &&
    "model" in document &&
    typeof document.model === "string"
    ? document.model
    : null;
}

function responseUsage(document: unknown): ModelUsage | undefined {
  if (
    !document ||
    typeof document !== "object" ||
    !("usage" in document) ||
    !document.usage ||
    typeof document.usage !== "object"
  ) {
    return undefined;
  }
  const usage = document.usage;
  return {
    promptTokens:
      "prompt_tokens" in usage
        ? nonNegativeInteger(usage.prompt_tokens)
        : null,
    completionTokens:
      "completion_tokens" in usage
        ? nonNegativeInteger(usage.completion_tokens)
        : null,
    totalTokens:
      "total_tokens" in usage
        ? nonNegativeInteger(usage.total_tokens)
        : null,
  };
}

function mergeUsage(
  first: ModelUsage | undefined,
  second: ModelUsage | undefined,
): ModelUsage | undefined {
  if (!first) return second;
  if (!second) return undefined;
  const sum = (left: number | null, right: number | null): number | null =>
    left === null || right === null ? null : left + right;
  return {
    promptTokens: sum(first.promptTokens, second.promptTokens),
    completionTokens: sum(first.completionTokens, second.completionTokens),
    totalTokens: sum(first.totalTokens, second.totalTokens),
  };
}

function schemaIssues(error: unknown): string[] {
  if (error instanceof ZodError) {
    return error.issues.map(
      (issue) => `${issue.path.join(".") || "result"}: ${issue.message}`,
    );
  }
  return [safeError(error)];
}

export class QwenVideoAnnotationProvider implements VideoAnnotationProvider {
  private readonly endpoint: string;
  private readonly fetcher: Fetcher;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly pendingPermits: Array<() => void> = [];
  private activeCalls = 0;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
      prompt: LoadedVideoAnnotationPrompt;
      maxConcurrency?: number;
      fetcher?: Fetcher;
      sleep?: (milliseconds: number) => Promise<void>;
    },
  ) {
    this.endpoint = `${stripTrailingSlash(options.baseUrl)}/chat/completions`;
    this.fetcher = options.fetcher ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async annotate(
    request: VideoAnnotationRequest,
    signal?: AbortSignal,
  ): Promise<VideoAnnotationCandidate> {
    try {
      return await this.annotateStrict(request, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        status: "system_failed",
        schemaVersion: VIDEO_ANNOTATION_SCHEMA_VERSION,
        policyVersion: VIDEO_ANNOTATION_POLICY_VERSION,
        promptVersion: this.options.prompt.promptVersion,
        promptContentSha256: this.options.prompt.contentSha256,
        model: this.options.prompt.model,
        error: safeError(error),
      };
    }
  }

  /** 独立 Worker 使用：保留 Provider 错误类型，交由运行状态机决定重试或终止。 */
  async annotateStrict(
    request: VideoAnnotationRequest,
    signal?: AbortSignal,
  ): Promise<VideoAnnotationCandidateSuccess> {
    let release: (() => void) | undefined;
    try {
      release = await this.acquirePermit(signal);
      return await this.annotateOrThrow(request, signal);
    } finally {
      release?.();
    }
  }

  private acquirePermit(signal?: AbortSignal): Promise<() => void> {
    const maxConcurrency = this.options.maxConcurrency ?? 1;
    if (this.activeCalls < maxConcurrency) {
      this.activeCalls += 1;
      return Promise.resolve(this.releasePermit());
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const grant = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        this.activeCalls += 1;
        resolve(this.releasePermit());
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        const index = this.pendingPermits.indexOf(grant);
        if (index >= 0) this.pendingPermits.splice(index, 1);
        reject(signal?.reason ?? new Error("候选标注已取消"));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.pendingPermits.push(grant);
    });
  }

  private releasePermit(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCalls = Math.max(0, this.activeCalls - 1);
      this.pendingPermits.shift()?.();
    };
  }

  private async annotateOrThrow(
    request: VideoAnnotationRequest,
    signal?: AbortSignal,
  ): Promise<VideoAnnotationCandidateSuccess> {
    if (request.frames.length < 4 || request.frames.length > 8_000) {
      throw new VideoAnnotationProviderError(
        `候选标注需要 4–8000 帧，实际 ${request.frames.length} 帧`,
        400,
        null,
      );
    }
    const selectedFrames = annotationFrames(request.frames);
    const selectedRequest = { ...request, frames: selectedFrames };
    const startedAt = Date.now();
    const messages = this.analysisMessages(selectedRequest);
    const first = await this.call(messages, signal);
    let raw;
    let finalRequestId = first.requestId;
    let finalResponseModel = first.responseModel;
    let totalUsage = first.usage;
    try {
      raw = parseRawVideoAnnotation(extractJson(first.content));
    } catch (error) {
      const repairMessages: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `上一个输出不符合 ${this.options.prompt.outputSchema}。只返回修正后的合法 JSON。`,
                ...schemaIssues(error).slice(0, 20),
                `output_contract=${JSON.stringify(this.options.prompt.outputExample)}`,
              ].join("\n"),
            },
          ],
        },
      ];
      const repaired = await this.call(repairMessages, signal);
      finalRequestId = repaired.requestId;
      finalResponseModel = repaired.responseModel;
      totalUsage = mergeUsage(first.usage, repaired.usage);
      try {
        raw = parseRawVideoAnnotation(extractJson(repaired.content));
      } catch (repairError) {
        throw new VideoAnnotationProviderError(
          `候选标注结构修复失败：${schemaIssues(repairError).join("; ").slice(0, 1_500)}`,
          null,
          finalRequestId,
        );
      }
    }
    if (raw.video_id !== request.videoId) {
      throw new VideoAnnotationProviderError(
        "候选标注返回的 video_id 与请求不一致",
        null,
        finalRequestId,
      );
    }
    return normalizeVideoAnnotation({
      raw,
      frames: selectedFrames,
      durationMs: request.durationMs,
      promptVersion: this.options.prompt.promptVersion,
      promptContentSha256: this.options.prompt.contentSha256,
      model: this.options.prompt.model,
      responseModel: finalResponseModel,
      requestId: finalRequestId,
      modelDurationMs: Date.now() - startedAt,
      ...(totalUsage ? { usage: totalUsage } : {}),
      enabledLabels: request.enabledLabels,
    });
  }

  private analysisMessages(request: VideoAnnotationRequest): ChatMessage[] {
    const frameContent: ChatContentPart[] = request.frames.flatMap(
      (frame, frameIndex): ChatContentPart[] => [
        {
          type: "text",
          text: `FRAME ${frameIndex} | timestamp_ms=${frame.timestampMs}`,
        },
        { type: "image_url", image_url: { url: frame.dataUrl } },
      ],
    );
    return [
      { role: "system", content: this.options.prompt.systemPrompt },
      {
        role: "user",
        content: [
          ...frameContent,
          {
            type: "text",
            text: JSON.stringify({
              video_id: request.videoId,
              duration_ms: request.durationMs,
              frame_manifest: request.frames.map((frame, frameIndex) => ({
                frame_index: frameIndex,
                timestamp_ms: frame.timestampMs,
              })),
              frame_timestamps_ms: request.frames.map(
                (frame) => frame.timestampMs,
              ),
              annotation_context: {
                enabled_labels: request.enabledLabels,
              },
              requested_output_schema: this.options.prompt.outputSchema,
              output_contract: this.options.prompt.outputExample,
              output_requirements: [
                "只返回一个合法 JSON 对象。",
                "不得输出通过、拒绝、结算或任务符合度判断。",
                "不得引用 frame_timestamps_ms 之外的证据时间点。",
              ],
            }),
          },
        ],
      },
    ];
  }

  private async call(
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<ModelCallResult> {
    const delays = [0, 500, 1_500];
    let lastError: unknown;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (signal?.aborted) throw signal.reason;
      const delay = delays[attempt] ?? 0;
      if (delay > 0) await this.sleep(delay);
      try {
        const timeout = AbortSignal.timeout(this.options.timeoutMs);
        const requestSignal = signal
          ? AbortSignal.any([signal, timeout])
          : timeout;
        const response = await this.fetcher(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.options.prompt.model,
            messages,
            stream: false,
            enable_thinking: false,
            temperature: 0,
            max_tokens: 8_000,
            response_format: { type: "json_object" },
          }),
          signal: requestSignal,
        });
        if (!response.ok) {
          const requestId = responseRequestId(response);
          const retryable = response.status === 429 || response.status >= 500;
          const error = new VideoAnnotationProviderError(
            `百炼候选标注请求失败（HTTP ${response.status}）`,
            response.status,
            requestId,
          );
          if (retryable && attempt < delays.length - 1) {
            lastError = error;
            continue;
          }
          throw error;
        }
        const document = (await response.json()) as unknown;
        const usage = responseUsage(document);
        return {
          content: responseContent(document),
          requestId: responseRequestId(response, document),
          responseModel: responseModel(document),
          ...(usage ? { usage } : {}),
        };
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof VideoAnnotationProviderError) throw error;
        if (
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError")
        ) {
          throw new VideoAnnotationProviderError(
            `百炼候选标注请求超时：${safeError(error)}`,
            408,
            null,
          );
        }
        lastError = error;
        if (attempt >= delays.length - 1) break;
      }
    }
    throw new VideoAnnotationProviderError(
      `百炼候选标注网络请求失败：${safeError(lastError)}`,
      null,
      null,
    );
  }
}
