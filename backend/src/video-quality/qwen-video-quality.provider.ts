import type { LoadedVideoQualityPrompt } from "./prompt-loader.js";
import {
  parseRawVideoQcResult,
  VideoQcSchemaError,
} from "./video-qc-schema.js";
import type {
  BailianCallDiagnostic,
  ModelRunMetadata,
  RawVideoQcResultV1,
  TimestampedFrame,
  VideoQcInputV1,
  VideoQualityModelConfig,
} from "./video-quality.types.js";

type Fetcher = typeof fetch;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "video"; video: string[] }
        | { type: "text"; text: string }
      >;
};

export type ModelRunResult = {
  raw: RawVideoQcResultV1;
  metadata: ModelRunMetadata;
};

export type AnalyzeVideoQualityRequest = {
  input: VideoQcInputV1;
  frames: TimestampedFrame[];
};

export type ReviewVideoQualityRequest = AnalyzeVideoQualityRequest & {
  initialResult: RawVideoQcResultV1;
  reviewReasons: string[];
};

export class BailianRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

type ProviderOptions = {
  config: VideoQualityModelConfig;
  prompt: LoadedVideoQualityPrompt;
  fetcher?: Fetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  diagnosticSink?: (diagnostic: BailianCallDiagnostic) => void;
};

type CallInput = {
  taskId: string;
  model: string;
  modelStage: "initial" | "review";
  operation: "analysis" | "review" | "repair";
  messages: ChatMessage[];
  signal?: AbortSignal;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function redactedErrorText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
    .replace(/sk-(?:ws-)?[A-Za-z0-9._-]+/gu, "<redacted>")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gu, "<data-url-redacted>")
    .replace(/\/(?:private\/)?tmp\/[A-Za-z0-9_./ -]+/gu, "<temp>")
    .slice(0, 500);
}

function errorDetails(error: unknown): {
  errorName: string;
  errorCode?: string;
  errorMessage: string;
} {
  const candidate = error instanceof Error ? error : new Error(String(error));
  const cause = candidate.cause;
  const causeRecord =
    cause && typeof cause === "object"
      ? (cause as Record<string, unknown>)
      : undefined;
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : typeof causeRecord?.message === "string"
        ? causeRecord.message
        : undefined;
  const errorCode =
    typeof causeRecord?.code === "string"
      ? causeRecord.code
      : typeof (candidate as Error & { code?: unknown }).code === "string"
        ? (candidate as Error & { code: string }).code
        : undefined;
  return {
    errorName: redactedErrorText(candidate.name || "Error"),
    ...(errorCode ? { errorCode: redactedErrorText(errorCode) } : {}),
    errorMessage: redactedErrorText(
      causeMessage ? `${candidate.message}: ${causeMessage}` : candidate.message,
    ),
  };
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function requestId(response: Response, document: unknown): string | null {
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

function messageContent(document: unknown): string {
  if (!document || typeof document !== "object" || !("choices" in document)) {
    throw new BailianRequestError("百炼响应缺少 choices", null, null);
  }
  const choices = document.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new BailianRequestError("百炼响应 choices 为空", null, null);
  }
  const first = choices[0];
  if (!first || typeof first !== "object" || !("message" in first)) {
    throw new BailianRequestError("百炼响应缺少 message", null, null);
  }
  const message = first.message;
  if (!message || typeof message !== "object" || !("content" in message)) {
    throw new BailianRequestError("百炼响应缺少 message.content", null, null);
  }
  const content: unknown = message.content;
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
  throw new BailianRequestError("百炼响应 content 类型无效", null, null);
}

function outputInstructions(prompt: LoadedVideoQualityPrompt): {
  requested_output_schema: string;
  output_contract: Record<string, unknown>;
  output_requirements: string[];
} {
  return {
    requested_output_schema: prompt.outputSchema,
    output_contract: prompt.outputExample,
    output_requirements: [
      "只返回一个合法 JSON 对象，不要返回 Markdown 或解释文字。",
      "严格使用 output_contract 中的字段名和嵌套层级，不得改名或遗漏字段。",
      "没有内容的数组返回 []；不得为了填充示例而输出空白占位对象。",
      "数值和枚举必须符合系统提示词；不要输出 pass/fail 或结算字段。",
      "task_summary、summary、description、calculation_trace、recommendations、review_reasons 等所有自然语言字段必须使用简体中文；字段名、枚举和 reason_code 保持原值。",
    ],
  };
}

const simplifiedChinesePattern = /[\u3400-\u9fff]/u;

function chineseLanguageIssues(raw: RawVideoQcResultV1): string[] {
  const issues: string[] = [];
  const check = (path: string, value: string): void => {
    if (value.trim() && !simplifiedChinesePattern.test(value)) {
      issues.push(`${path}: 自然语言内容必须使用简体中文`);
    }
  };

  check("detected_task.task_summary", raw.detected_task.task_summary);
  check("summary", raw.summary);
  raw.recommendations.forEach((value, index) =>
    check(`recommendations.${index}`, value),
  );
  raw.review_reasons.forEach((value, index) =>
    check(`review_reasons.${index}`, value),
  );
  for (const [dimension, value] of Object.entries(raw.dimensions)) {
    check(`dimensions.${dimension}.calculation_trace`, value.calculation_trace);
    value.issues.forEach((issue, index) =>
      check(`dimensions.${dimension}.issues.${index}.description`, issue.description),
    );
    value.segments.forEach((segment, index) => {
      for (const [key, field] of Object.entries(segment)) {
        if (
          typeof field === "string" &&
          ["description", "summary", "calculation_trace"].includes(key)
        ) {
          check(`dimensions.${dimension}.segments.${index}.${key}`, field);
        }
      }
    });
  }
  raw.billing_observations.candidate_invalid_segments.forEach((segment, index) =>
    check(`billing_observations.candidate_invalid_segments.${index}.description`, segment.description),
  );
  raw.billing_observations.candidate_valid_waiting_segments.forEach(
    (segment, index) =>
      check(
        `billing_observations.candidate_valid_waiting_segments.${index}.description`,
        segment.description,
      ),
  );
  raw.deductions.forEach((deduction, index) =>
    check(`deductions.${index}.description`, deduction.description),
  );
  return issues;
}

function parseChineseRawVideoQcResult(value: unknown): RawVideoQcResultV1 {
  const raw = parseRawVideoQcResult(value);
  const issues = chineseLanguageIssues(raw);
  if (issues.length > 0) {
    throw new VideoQcSchemaError("模型自然语言结果不是简体中文", issues);
  }
  return raw;
}

export class QwenVideoQualityProvider {
  private readonly config: VideoQualityModelConfig;
  private readonly prompt: LoadedVideoQualityPrompt;
  private readonly fetcher: Fetcher;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly endpoint: string;
  private readonly diagnosticSink: (diagnostic: BailianCallDiagnostic) => void;

  constructor(options: ProviderOptions) {
    this.config = options.config;
    this.prompt = options.prompt;
    this.fetcher = options.fetcher ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.endpoint = `${stripTrailingSlash(this.config.baseUrl)}/chat/completions`;
    this.diagnosticSink = options.diagnosticSink ?? (() => undefined);
  }

  async analyze(
    request: AnalyzeVideoQualityRequest,
    signal?: AbortSignal,
  ): Promise<ModelRunResult> {
    const messages = this.messagesForAnalysis(request);
    return this.run({
      model: this.config.initialModel,
      stage: "initial",
      messages,
      frameCount: request.frames.length,
      taskId: request.input.video_id,
      signal,
    });
  }

  async review(
    request: ReviewVideoQualityRequest,
    signal?: AbortSignal,
  ): Promise<ModelRunResult> {
    const messages = this.messagesForReview(request);
    return this.run({
      model: this.config.reviewModel,
      stage: "review",
      messages,
      frameCount: request.frames.length,
      taskId: request.input.video_id,
      signal,
    });
  }

  private messagesForAnalysis(
    request: AnalyzeVideoQualityRequest,
  ): ChatMessage[] {
    return [
      { role: "system", content: this.prompt.systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "video",
            video: request.frames.map((frame) => frame.dataUrl),
          },
          {
            type: "text",
            text: JSON.stringify({
              ...request.input,
              frame_timestamps_ms: request.frames.map(
                (frame) => frame.timestampMs,
              ),
              ...outputInstructions(this.prompt),
            }),
          },
        ],
      },
    ];
  }

  private messagesForReview(request: ReviewVideoQualityRequest): ChatMessage[] {
    return [
      { role: "system", content: this.prompt.systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "video",
            video: request.frames.map((frame) => frame.dataUrl),
          },
          {
            type: "text",
            text: JSON.stringify({
              review_request: {
                input: request.input,
                initial_result: request.initialResult,
                review_reasons: request.reviewReasons,
                controversy_frame_timestamps_ms: request.frames.map(
                  (frame) => frame.timestampMs,
                ),
              },
              ...outputInstructions(this.prompt),
            }),
          },
        ],
      },
    ];
  }

  private async run(input: {
    model: string;
    stage: "initial" | "review";
    messages: ChatMessage[];
    frameCount: number;
    taskId: string;
    signal?: AbortSignal;
  }): Promise<ModelRunResult> {
    const startedAt = Date.now();
    const first = await this.call({
      taskId: input.taskId,
      model: input.model,
      modelStage: input.stage,
      operation: input.stage === "initial" ? "analysis" : "review",
      messages: input.messages,
      signal: input.signal,
    });
    let raw: RawVideoQcResultV1;
    let finalRequestId = first.requestId;
    try {
      raw = parseChineseRawVideoQcResult(extractJson(first.content));
    } catch (error) {
      const validationIssues =
        error instanceof VideoQcSchemaError
          ? error.validationIssues
          : [error instanceof Error ? error.message : "JSON 解析失败"];
      const repairMessages: ChatMessage[] = [
        ...input.messages,
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "上一个输出不符合 video_qc_result_v1。请只返回修正后的合法 JSON。",
                "必须严格保留下面 output_contract 的所有字段名和嵌套层级；没有内容的数组返回 []。",
                "所有自然语言字段必须改写为简体中文；字段名、枚举和 reason_code 保持原值。",
                ...validationIssues.slice(0, 20),
                `output_contract=${JSON.stringify(this.prompt.outputExample)}`,
              ].join("\n"),
            },
          ],
        },
      ];
      const repaired = await this.call({
        taskId: input.taskId,
        model: input.model,
        modelStage: input.stage,
        operation: "repair",
        messages: repairMessages,
        signal: input.signal,
      });
      finalRequestId = repaired.requestId;
      try {
        raw = parseChineseRawVideoQcResult(extractJson(repaired.content));
      } catch (repairError) {
        const issues =
          repairError instanceof VideoQcSchemaError
            ? repairError.validationIssues.join("; ")
            : repairError instanceof Error
              ? repairError.message
              : "unknown";
        throw new BailianRequestError(
          `模型结构化结果修复失败：${issues.slice(0, 1_000)}`,
          null,
          finalRequestId,
        );
      }
    }

    return {
      raw,
      metadata: {
        stage: input.stage,
        model: input.model,
        requestId: finalRequestId,
        durationMs: Date.now() - startedAt,
        frameCount: input.frameCount,
      },
    };
  }

  private emitDiagnostic(diagnostic: BailianCallDiagnostic): void {
    try {
      this.diagnosticSink(diagnostic);
    } catch {
      // Diagnostic persistence must never change a model-call outcome.
    }
  }

  private async call(
    input: CallInput,
  ): Promise<{ content: string; requestId: string | null }> {
    const delays = [0, 500, 1_500];
    let lastError: unknown;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (input.signal?.aborted) throw input.signal.reason;
      const delay = delays[attempt] ?? 0;
      if (delay > 0) await this.sleep(delay);
      const attemptStartedAt = new Date();
      try {
        const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
        const signal = input.signal
          ? AbortSignal.any([input.signal, timeoutSignal])
          : timeoutSignal;
        const response = await this.fetcher(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            messages: input.messages,
            stream: false,
            enable_thinking: false,
            temperature: 0,
            response_format: { type: "json_object" },
          }),
          signal,
        });
        if (!response.ok) {
          const id = response.headers.get("x-request-id");
          const retryable = response.status === 429 || response.status >= 500;
          this.emitDiagnostic({
            taskId: input.taskId,
            modelStage: input.modelStage,
            operation: input.operation,
            model: input.model,
            attempt: attempt + 1,
            startedAt: attemptStartedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - attemptStartedAt.getTime(),
            outcome: "http_error",
            httpStatus: response.status,
            requestId: id,
            retryable: retryable && attempt < delays.length - 1,
            errorName: "BailianRequestError",
            errorCode: `HTTP_${response.status}`,
            errorMessage: `百炼请求失败（HTTP ${response.status}）`,
          });
          const error = new BailianRequestError(
            `百炼请求失败（HTTP ${response.status}）`,
            response.status,
            id,
          );
          if (retryable && attempt < delays.length - 1) {
            lastError = error;
            continue;
          }
          throw error;
        }
        let document: unknown;
        let content: string;
        try {
          document = (await response.json()) as unknown;
          content = messageContent(document);
        } catch (error) {
          const details = errorDetails(error);
          this.emitDiagnostic({
            taskId: input.taskId,
            modelStage: input.modelStage,
            operation: input.operation,
            model: input.model,
            attempt: attempt + 1,
            startedAt: attemptStartedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - attemptStartedAt.getTime(),
            outcome: "invalid_response",
            httpStatus: response.status,
            requestId: requestId(response, document),
            retryable: false,
            ...details,
          });
          throw new BailianRequestError(
            `百炼响应无法解析：${details.errorName}`,
            response.status,
            requestId(response, document),
          );
        }
        const finalRequestId = requestId(response, document);
        this.emitDiagnostic({
          taskId: input.taskId,
          modelStage: input.modelStage,
          operation: input.operation,
          model: input.model,
          attempt: attempt + 1,
          startedAt: attemptStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartedAt.getTime(),
          outcome: "success",
          httpStatus: response.status,
          requestId: finalRequestId,
          retryable: false,
        });
        return {
          content,
          requestId: finalRequestId,
        };
      } catch (error) {
        if (input.signal?.aborted) throw input.signal.reason;
        if (error instanceof BailianRequestError) throw error;
        lastError = error;
        const details = errorDetails(error);
        this.emitDiagnostic({
          taskId: input.taskId,
          modelStage: input.modelStage,
          operation: input.operation,
          model: input.model,
          attempt: attempt + 1,
          startedAt: attemptStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartedAt.getTime(),
          outcome: "network_error",
          httpStatus: null,
          requestId: null,
          retryable: attempt < delays.length - 1,
          ...details,
        });
        if (attempt >= delays.length - 1) break;
      }
    }
    const finalDetails = errorDetails(lastError);
    throw new BailianRequestError(
      `百炼网络请求失败：${finalDetails.errorName}${
        finalDetails.errorCode ? `（${finalDetails.errorCode}）` : ""
      } · ${finalDetails.errorMessage}`,
      null,
      null,
    );
  }
}
