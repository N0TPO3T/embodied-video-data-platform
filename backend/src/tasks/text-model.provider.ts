type Fetcher = typeof fetch;

export class TextModelRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "TextModelRequestError";
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function redactedErrorText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
    .replace(/sk-(?:ws-)?[A-Za-z0-9._-]+/gu, "<redacted>")
    .slice(0, 500);
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

export type TextModelConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetcher?: Fetcher;
  sleep?: (milliseconds: number) => Promise<void>;
};

type GenerateJsonOptions = {
  system: string;
  user: string;
  signal?: AbortSignal;
};

export type GenerateJsonResult<T> = {
  data: T;
  requestId: string | null;
};

/**
 * 百炼 OpenAI 兼容模式的纯文本模型调用（用于任务要求规范化等轻量 JSON 任务）。
 * 复用 AI 质检的调用模式：三次延迟重试、json_object 响应格式、禁用思考链、零温度。
 */
export class TextModelProvider {
  private readonly config: TextModelConfig;
  private readonly fetcher: Fetcher;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly endpoint: string;

  constructor(config: TextModelConfig) {
    this.config = config;
    this.fetcher = config.fetcher ?? fetch;
    this.sleep =
      config.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.endpoint = `${stripTrailingSlash(config.baseUrl)}/chat/completions`;
  }

  async generateJson<T>(
    input: GenerateJsonOptions,
  ): Promise<GenerateJsonResult<T>> {
    const content = await this.call(input);
    let data: unknown;
    try {
      data = extractJson(content.content);
    } catch (error) {
      throw new TextModelRequestError(
        `文本模型响应不是合法 JSON：${
          error instanceof Error ? error.message : "unknown"
        }`,
        null,
        content.requestId,
      );
    }
    return { data: data as T, requestId: content.requestId };
  }

  private async call(input: GenerateJsonOptions): Promise<{
    content: string;
    requestId: string | null;
  }> {
    const delays = [0, 500, 1_500];
    let lastError: unknown;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (input.signal?.aborted) throw input.signal.reason;
      const delay = delays[attempt] ?? 0;
      if (delay > 0) await this.sleep(delay);
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
            model: this.config.model,
            messages: [
              { role: "system", content: input.system },
              { role: "user", content: input.user },
            ],
            stream: false,
            enable_thinking: false,
            temperature: 0,
            response_format: { type: "json_object" },
          }),
          signal,
        });
        if (!response.ok) {
          let message = `文本模型请求失败（HTTP ${response.status}）`;
          try {
            const text = redactedErrorText((await response.text()).trim());
            if (text) message += `：${text}`;
          } catch {
            // 忽略响应体读取失败
          }
          const error = new TextModelRequestError(
            message,
            response.status,
            response.headers.get("x-request-id"),
          );
          const retryable = response.status === 429 || response.status >= 500;
          if (retryable && attempt < delays.length - 1) {
            lastError = error;
            continue;
          }
          throw error;
        }
        const document = (await response.json()) as unknown;
        const content = this.messageContent(document, response);
        return {
          content,
          requestId: this.requestId(response, document),
        };
      } catch (error) {
        if (input.signal?.aborted) throw input.signal.reason;
        if (error instanceof TextModelRequestError) throw error;
        lastError = error;
        if (attempt >= delays.length - 1) break;
      }
    }
    const message =
      lastError instanceof Error ? lastError.message : "网络请求失败";
    throw new TextModelRequestError(
      `文本模型网络请求失败：${redactedErrorText(message)}`,
      null,
      null,
    );
  }

  private messageContent(document: unknown, response: Response): string {
    if (!document || typeof document !== "object" || !("choices" in document)) {
      throw new TextModelRequestError(
        "文本模型响应缺少 choices",
        response.status,
        this.requestId(response, document),
      );
    }
    const choices = document.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new TextModelRequestError(
        "文本模型响应 choices 为空",
        response.status,
        this.requestId(response, document),
      );
    }
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) =>
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof part.text === "string"
            ? part.text
            : "",
        )
        .join("");
    }
    throw new TextModelRequestError(
      "文本模型响应 content 类型无效",
      response.status,
      this.requestId(response, document),
    );
  }

  private requestId(response: Response, document: unknown): string | null {
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
}
