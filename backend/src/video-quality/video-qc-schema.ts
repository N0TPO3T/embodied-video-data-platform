import { z } from "zod";

import type { RawVideoQcResultV1 } from "./video-quality.types.js";

const boundedCoefficient = z.number().finite().min(0).max(1);
const nonNegativeTime = z.number().finite().nonnegative();

const issueSchema = z
  .object({
    dimension: z.string().optional(),
    reason_code: z.string().min(1),
    description: z.string(),
    start_ms: nonNegativeTime,
    end_ms: nonNegativeTime,
    severity: z.enum(["minor", "moderate", "major", "critical"]),
    confidence: boundedCoefficient,
    evidence_timestamps_ms: z.array(nonNegativeTime),
  })
  .strict();

const dimensionSchema = z
  .object({
    coefficient: boundedCoefficient,
    score: z.number().finite().min(0).max(20),
    confidence: boundedCoefficient,
    calculation_trace: z.string(),
    // V1 文档的 D5 示例没有 segments；内部仍归一化为空数组。
    segments: z.array(z.record(z.string(), z.unknown())).default([]),
    issues: z.array(issueSchema.omit({ dimension: true })),
    hand_active_duration_ms: nonNegativeTime.optional(),
    c_spec: boundedCoefficient.optional(),
    c_visual: boundedCoefficient.optional(),
    completion_coefficient: boundedCoefficient.optional(),
    inventory_coefficient: boundedCoefficient.optional(),
    unique_coefficient: boundedCoefficient.optional(),
    similarity_total: boundedCoefficient.optional(),
  })
  .strict();

const invalidSegmentSchema = z
  .object({
    reason_code: z.string().min(1),
    description: z.string(),
    start_ms: nonNegativeTime,
    end_ms: nonNegativeTime,
    confidence: boundedCoefficient,
    evidence_timestamps_ms: z.array(nonNegativeTime),
  })
  .strict();

const waitingSegmentSchema = z
  .object({
    waiting_type: z.string().min(1),
    description: z.string(),
    start_ms: nonNegativeTime,
    end_ms: nonNegativeTime,
    confidence: boundedCoefficient,
    evidence_timestamps_ms: z.array(nonNegativeTime),
  })
  .strict();

export const rawVideoQcResultSchema = z
  .object({
    schema_version: z.literal("video_qc_result_v1"),
    rule_version: z.literal("video_qc_v1"),
    prompt_version: z.literal("qwen_video_qc_prompt_v1"),
    video_id: z.string().min(1),
    evaluation_status: z.enum([
      "scored",
      "hard_reject",
      "incomplete_input",
      "review_pending",
    ]),
    hard_veto: z
      .object({
        triggered: z.boolean(),
        reasons: z.array(
          z.union([z.string(), z.record(z.string(), z.unknown())]),
        ),
      })
      .strict(),
    detected_task: z
      .object({
        scene_id: z.string(),
        task_id: z.string(),
        variant_id: z.string(),
        task_summary: z.string(),
        confidence: boundedCoefficient,
      })
      .strict(),
    dimensions: z
      .object({
        first_person_and_composition: dimensionSchema,
        hand_forearm_object_integrity: dimensionSchema,
        frame_and_video_quality: dimensionSchema,
        task_authenticity_completeness: dimensionSchema,
        task_value_uniqueness: dimensionSchema,
      })
      .strict(),
    billing_observations: z
      .object({
        candidate_invalid_segments: z.array(invalidSegmentSchema),
        candidate_valid_waiting_segments: z.array(waitingSegmentSchema),
      })
      .strict(),
    raw_total_score: z.number().finite().min(0).max(100),
    final_score: z.number().finite().min(0).max(100),
    summary: z.string(),
    deductions: z.array(issueSchema),
    recommendations: z.array(z.string()),
    review_required: z.boolean(),
    review_reasons: z.array(z.string()),
    missing_inputs: z.array(z.string()),
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
    throw new VideoQcSchemaError("模型结果不符合 video_qc_result_v1", issues);
  }
  return parsed.data as RawVideoQcResultV1;
}
