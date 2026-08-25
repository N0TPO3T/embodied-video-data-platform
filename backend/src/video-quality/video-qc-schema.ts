import { z } from "zod";

import {
  VIDEO_QC_PROMPT_VERSION,
  VIDEO_QC_RESULT_SCHEMA,
  VIDEO_QC_RULE_VERSION,
  type RawVideoQcResultV1,
} from "./video-quality.types.js";

const nonNegativeTime = z.number().finite().nonnegative();
const boundedCoefficient = z.number().finite().min(0).max(1);
const nullableNumber = z.number().finite().nullable();

const rawIssueSchema = z
  .object({
    reason_code: z.string().min(1),
    start_ms: nonNegativeTime.nullable(),
    end_ms: nonNegativeTime.nullable(),
    severity: z.enum(["info", "minor", "major", "critical"]),
    confidence: boundedCoefficient,
    evidence_timestamps_ms: z.array(nonNegativeTime),
    description: z.string(),
    source: z.enum([
      "visual_model",
      "technical_metrics",
      "deterministic_detector",
      "inventory_context",
      "similarity_context",
      "caller_input",
    ]),
  })
  .strict();

const rawDimensionSchema = z
  .object({
    score: z.number().finite().min(0).max(20).nullable(),
    coefficient: boundedCoefficient.nullable(),
    confidence: boundedCoefficient,
    metrics: z.record(z.string(), nullableNumber),
    issues: z.array(rawIssueSchema),
  })
  .strict();

const durationSegmentSchema = z
  .object({
    reason_code: z.string().min(1),
    description: z.string(),
    start_ms: nonNegativeTime.nullable(),
    end_ms: nonNegativeTime.nullable(),
    confidence: boundedCoefficient,
    evidence_timestamps_ms: z.array(nonNegativeTime),
    source: z.string().optional(),
    // 模型可能在无效片段上附带严重级别；仅作提示信息，服务端不依赖。
    severity: z.enum(["info", "minor", "major", "critical"]).optional(),
  })
  .strict();

const taskComplianceSchema = z
  .object({
    scene_match: z
      .object({
        matched: z.boolean(),
        confidence: boundedCoefficient,
        note: z.string().optional(),
      })
      .strict(),
    items: z.array(
      z
        .object({
          requirement: z.string().min(1),
          type: z.enum(["hard", "soft"]),
          result: z.enum(["met", "partial", "unmet"]),
          confidence: boundedCoefficient,
          evidence_timestamps_ms: z.array(nonNegativeTime),
        })
        .strict(),
    ),
    compliance_ratio: z.number().finite().min(0).max(1).nullable(),
    review_required: z.boolean(),
  })
  .strict();

export const rawVideoQcResultSchema = z
  .object({
    schema_version: z.literal(VIDEO_QC_RESULT_SCHEMA),
    rule_version: z.literal(VIDEO_QC_RULE_VERSION).optional(),
    prompt_version: z.literal(VIDEO_QC_PROMPT_VERSION).optional(),
    task_id: z.string().min(1),
    evaluation_status: z.enum([
      "completed",
      "hard_reject",
      "review_pending",
      "incomplete_input",
    ]),
    input_status: z
      .object({
        is_complete: z.boolean(),
        missing_required_inputs: z.array(z.string()),
        conflicts: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
      })
      .strict(),
    task_summary: z.string(),
    overall_result: z
      .object({
        raw_total_score: z.number().finite().min(0).max(100).nullable(),
        final_score: z.number().finite().min(0).max(100).nullable(),
        summary: z.string(),
      })
      .strict(),
    hard_reject: z
      .object({
        triggered: z.boolean(),
        reasons: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
        candidates: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
      })
      .strict(),
    dimensions: z
      .object({
        D1: rawDimensionSchema,
        D2: rawDimensionSchema,
        D3: rawDimensionSchema,
        D4: rawDimensionSchema,
        D5: rawDimensionSchema,
      })
      .strict(),
    review: z
      .object({
        review_required: z.boolean(),
        review_reasons: z.array(z.string()),
      })
      .strict(),
    duration_result: z
      .object({
        analysis_duration_ms: nonNegativeTime.nullable(),
        invalid_duration_ms: nonNegativeTime.nullable(),
        effective_duration_ms: nonNegativeTime.nullable(),
        effective_duration_ratio: z.number().finite().min(0).max(1).nullable(),
        invalid_segments: z.array(durationSegmentSchema),
        necessary_wait_segments: z.array(durationSegmentSchema),
      })
      .strict(),
    recommendations: z.array(z.string()),
    detectedTask: z
      .object({
        scene_id: z.string().nullable().optional(),
        standard_task_id: z.string().nullable().optional(),
        variant_id: z.string().nullable().optional(),
      })
      .strict()
      .optional(),
    task_compliance: taskComplianceSchema.optional().nullable(),
  })
  .strict();

export class VideoQcSchemaError extends Error {
  constructor(
    message: string,
    readonly validationIssues: string[],
  ) {
    super(message);
  }
}

export function parseRawVideoQcResult(value: unknown): RawVideoQcResultV1 {
  const parsed = rawVideoQcResultSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "result"}: ${issue.message}`,
    );
    throw new VideoQcSchemaError("模型结果不符合 video_qc_v2", issues);
  }
  return parsed.data as RawVideoQcResultV1;
}
