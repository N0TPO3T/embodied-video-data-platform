import { z } from "zod";

import type { TaskBoundarySampledFrame } from "./task-boundary-frame-sampler.js";
import { TASK_BOUNDARY_REFINEMENT_PROMPT_VERSION } from "./task-boundary-refinement.policy.js";

const startReason = z.enum([
  "CLEAR_TRANSITION",
  "GRADUAL_TRANSITION",
  "ACTION_ALREADY_STARTED",
  "INSUFFICIENT_EVIDENCE",
]);
const endReason = z.enum([
  "CLEAR_TRANSITION",
  "GRADUAL_TRANSITION",
  "RESULT_NOT_VISIBLE",
  "INSUFFICIENT_EVIDENCE",
]);
const sideStatus = z.enum(["refined", "unchanged", "not_observable"]);

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

export type TaskBoundaryRefinementOutput = z.infer<typeof outputSchema>;

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
refined_timestamp_ms 只能取 frame_manifest 中实际提供的 timestamp_ms；无法可靠判断时必须返回 not_observable，不得猜测任意毫秒。
输出必须严格匹配 task_boundary_refinement_prompt_v1 JSON，不得增加 task label、verb、objects、tools、actions、completion、result 或其他字段。`;

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
        response_format: { type: "json_object" },
      }),
      signal: requestSignal,
    });
    if (!response.ok) {
      throw new Error(`边界精修请求失败（HTTP ${response.status}）`);
    }
    const document = (await response.json()) as unknown;
    const rawModelOutput = extractJson(responseContent(document));
    const output = outputSchema.parse(rawModelOutput);
    const usage =
      document && typeof document === "object" && "usage" in document
        ? document.usage
        : null;
    return {
      output,
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
