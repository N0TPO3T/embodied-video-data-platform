import { z } from "zod";

import type { TaskBoundarySampledFrame } from "./task-boundary-frame-sampler.js";
import { TASK_BOUNDARY_REFINEMENT_PROMPT_VERSION } from "./task-boundary-refinement.policy.js";

export const TASK_BOUNDARY_SIDE_STATUSES = [
  "refined", "unchanged", "not_observable",
] as const;
export const TASK_BOUNDARY_START_REASON_CODES = [
  "CLEAR_TRANSITION",
  "GRADUAL_TRANSITION",
  "ACTION_ALREADY_STARTED",
  "INSUFFICIENT_EVIDENCE",
] as const;
export const TASK_BOUNDARY_END_REASON_CODES = [
  "CLEAR_TRANSITION",
  "GRADUAL_TRANSITION",
  "RESULT_NOT_VISIBLE",
  "INSUFFICIENT_EVIDENCE",
] as const;
const startReason = z.enum(TASK_BOUNDARY_START_REASON_CODES);
const endReason = z.enum(TASK_BOUNDARY_END_REASON_CODES);
const sideStatus = z.enum(TASK_BOUNDARY_SIDE_STATUSES);

const outputSchema = z.object({
  task_index: z.number().int().nonnegative(),
  start: z.object({
    coarse_timestamp_ms: z.number().finite(),
    refined_timestamp_ms: z.number().finite().nullable(),
    status: sideStatus,
    evidence_timestamps_ms: z.array(z.number().finite()).max(14),
    reason_code: startReason,
  }).strict(),
  end: z.object({
    coarse_timestamp_ms: z.number().finite(),
    refined_timestamp_ms: z.number().finite().nullable(),
    status: sideStatus,
    evidence_timestamps_ms: z.array(z.number().finite()).max(14),
    reason_code: endReason,
  }).strict(),
}).strict();

// Keep the provider's strict JSON Schema identical to the server-side contract.
const outputJsonSchema = z.toJSONSchema(outputSchema, { target: "draft-7" });

export type TaskBoundaryRefinementOutput = z.infer<typeof outputSchema>;

export class TaskBoundaryRefinementError extends Error {
  constructor(
    readonly failureCode:
      | "REFINEMENT_HTTP_FAILED"
      | "REFINEMENT_OUTPUT_NOT_JSON"
      | "REFINEMENT_OUTPUT_SCHEMA_INVALID",
    message: string,
    readonly rawModelOutput: unknown = null,
    readonly validationIssues: string[] = [message],
  ) {
    super(message);
    this.name = "TaskBoundaryRefinementError";
  }
}

export type TaskBoundaryRefinementRequest = {
  submissionId: string;
  annotationRunId: string;
  taskIndex: number;
  taskLabel: string;
  taskVerb: string;
  coarseStartMs: number;
  coarseEndMs: number;
  videoDurationMs: number;
  previousTask: { taskLabel: string; startMs: number; endMs: number } | null;
  nextTask: { taskLabel: string; startMs: number; endMs: number } | null;
  frames: TaskBoundarySampledFrame[];
  modelVersion: string;
};

export type TaskBoundaryProviderResult = {
  output: TaskBoundaryRefinementOutput;
  rawModelOutput: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  responseModel: string | null;
};

export interface TaskBoundaryRefinementProvider {
  refine(
    request: TaskBoundaryRefinementRequest,
    signal?: AbortSignal,
  ): Promise<TaskBoundaryProviderResult>;
}

export const TASK_BOUNDARY_REFINEMENT_PROVIDER = Symbol(
  "TASK_BOUNDARY_REFINEMENT_PROVIDER",
);

type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

const SYSTEM_PROMPT = `你是第一视角视频任务边界精修器。你只能在给定局部采样帧中精修当前已发现任务的 start/end，不得重新发现任务、修改任务语义或评价视频质量。
沿用上游 Annotation 对 task start/end 的既有定义，不重新定义“任务开始”和“任务结束”。
status 只能取：${TASK_BOUNDARY_SIDE_STATUSES.join(" | ")}。
start.reason_code 只能取：${TASK_BOUNDARY_START_REASON_CODES.join(" | ")}。
end.reason_code 只能取：${TASK_BOUNDARY_END_REASON_CODES.join(" | ")}。
status=refined 时，refined_timestamp_ms 必须取 frame_manifest 中对应 start/end 窗口的实际 timestamp_ms，且距 coarse 不超过 3000ms，不得猜测任意毫秒。
status=unchanged 时，refined_timestamp_ms 为 null 或属于实际采样帧的 coarse timestamp。
status=not_observable 时，refined_timestamp_ms 必须为 null，reason_code 应为 INSUFFICIENT_EVIDENCE。无法可靠判断时返回 not_observable，不要为产生变化而移动边界。
evidence_timestamps_ms 只能引用实际提供的采样帧；保持 task_index 和 coarse_timestamp_ms 不变。
输出顶层必须是一个 JSON 对象，且仅包含 task_index、start、end；禁止顶层数组、Markdown 或 output_contract 包装。
输出必须严格匹配 ${TASK_BOUNDARY_REFINEMENT_PROMPT_VERSION} JSON，不得增加 task label、verb、objects、tools、actions、completion、result 或其他字段。`;

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function responseContent(document: unknown): string {
  const choices =
    document && typeof document === "object" && "choices" in document
      ? document.choices
      : null;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("边界精修响应缺少 choices");
  }
  const choice = choices[0];
  if (!choice || typeof choice !== "object" || !("message" in choice)) {
    throw new Error("边界精修响应缺少 message");
  }
  const message = choice.message;
  if (!message || typeof message !== "object" || !("content" in message)) {
    throw new Error("边界精修响应缺少 message.content");
  }
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part: unknown) =>
        part && typeof part === "object" && "text" in part && typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("");
  }
  throw new Error("边界精修响应 content 类型无效");
}

function usageValue(usage: unknown, key: string): number | null {
  if (!usage || typeof usage !== "object" || !(key in usage)) return null;
  const value = (usage as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

export class QwenTaskBoundaryRefinementProvider
  implements TaskBoundaryRefinementProvider
{
  private readonly endpoint: string;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
      fetcher?: typeof fetch;
    },
  ) {
    this.endpoint = `${stripTrailingSlash(options.baseUrl)}/chat/completions`;
  }

  async refine(
    request: TaskBoundaryRefinementRequest,
    signal?: AbortSignal,
  ): Promise<TaskBoundaryProviderResult> {
    if (!this.options.apiKey || !this.options.baseUrl) {
      throw new Error("QWEN_API_KEY / QWEN_BASE_URL 未配置，边界精修回退 coarse boundary");
    }
    const startedAt = Date.now();
    const frameParts: ChatPart[] = request.frames.flatMap((frame, index) => [
      {
        type: "text",
        text: `FRAME ${index} | timestamp_ms=${frame.timestampMs} | windows=${frame.windows.join(",")}`,
      },
      { type: "image_url", image_url: { url: frame.dataUrl } },
    ]);
    const context = {
      prompt_version: TASK_BOUNDARY_REFINEMENT_PROMPT_VERSION,
      submission_id: request.submissionId,
      annotation_run_id: request.annotationRunId,
      task_index: request.taskIndex,
      task: {
        label: request.taskLabel,
        verb: request.taskVerb,
        coarse_start_ms: request.coarseStartMs,
        coarse_end_ms: request.coarseEndMs,
      },
      video_duration_ms: request.videoDurationMs,
      previous_task: request.previousTask,
      next_task: request.nextTask,
      frame_manifest: request.frames.map((frame, index) => ({
        frame_index: index,
        timestamp_ms: frame.timestampMs,
        windows: frame.windows,
      })),
      output_contract: {
        task_index: request.taskIndex,
        start: {
          coarse_timestamp_ms: request.coarseStartMs,
          refined_timestamp_ms: null,
          status: "not_observable",
          evidence_timestamps_ms: [],
          reason_code: "INSUFFICIENT_EVIDENCE",
        },
        end: {
          coarse_timestamp_ms: request.coarseEndMs,
          refined_timestamp_ms: null,
          status: "not_observable",
          evidence_timestamps_ms: [],
          reason_code: "INSUFFICIENT_EVIDENCE",
        },
      },
    };
    const fetcher = this.options.fetcher ?? fetch;
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetcher(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.modelVersion,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [...frameParts, { type: "text", text: JSON.stringify(context) }],
          },
        ],
        stream: false,
        enable_thinking: false,
        temperature: 0,
        max_tokens: 2_000,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "task_boundary_refinement_v1",
            strict: true,
            schema: outputJsonSchema,
          },
        },
      }),
      signal: requestSignal,
    }).catch((error: unknown) => {
      throw new TaskBoundaryRefinementError(
        "REFINEMENT_HTTP_FAILED",
        `边界精修请求未完成：${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (!response.ok) {
      throw new TaskBoundaryRefinementError(
        "REFINEMENT_HTTP_FAILED",
        `边界精修请求失败（HTTP ${response.status}）`,
      );
    }
    const responseText = await response.text().catch((error: unknown) => {
      throw new TaskBoundaryRefinementError(
        "REFINEMENT_HTTP_FAILED",
        `边界精修响应读取失败：${error instanceof Error ? error.message : String(error)}`,
      );
    });
    let document: unknown;
    let rawModelOutput: unknown = responseText;
    try {
      document = JSON.parse(responseText) as unknown;
      rawModelOutput = document;
      const content = responseContent(document);
      rawModelOutput = content;
      rawModelOutput = extractJson(content);
    } catch {
      throw new TaskBoundaryRefinementError(
        "REFINEMENT_OUTPUT_NOT_JSON",
        "边界精修响应缺少可解析的 JSON 模型内容",
        rawModelOutput,
      );
    }
    const parsed = outputSchema.safeParse(rawModelOutput);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "$"}: ${issue.message}`,
      );
      throw new TaskBoundaryRefinementError(
        "REFINEMENT_OUTPUT_SCHEMA_INVALID",
        issues.join("; "),
        rawModelOutput,
        issues,
      );
    }
    const usage =
      document && typeof document === "object" && "usage" in document
        ? document.usage
        : null;
    return {
      output: parsed.data,
      rawModelOutput,
      inputTokens: usageValue(usage, "prompt_tokens"),
      outputTokens: usageValue(usage, "completion_tokens"),
      latencyMs: Date.now() - startedAt,
      responseModel:
        document && typeof document === "object" && "model" in document && typeof document.model === "string"
          ? document.model
          : null,
    };
  }
}
