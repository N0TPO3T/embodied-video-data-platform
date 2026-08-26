import { describe, expect, it } from "vitest";

import { acceptedDeliveryAnnotation } from "../src/delivery/delivery-annotation.js";

function normalizedResult() {
  return {
    candidateAnnotation: {
      status: "review_required",
      schemaVersion: "ego_video_annotation_v1",
      policyVersion: "ego_annotation_evidence_policy_v1",
      promptVersion: "ego_video_annotation_prompt_v1",
      promptContentSha256: "a".repeat(64),
      model: "qwen-vl-max",
      effective: { video_id: "SUB-1", tasks: [] },
      labelMappings: [],
      validation: { errors: [] as string[], warnings: ["sparse"] },
    },
    annotationReview: {
      decision: "accepted",
      reason: "人工确认画面内容",
      reviewedByAccountId: "U-ADMIN",
      reviewedByName: "审核员",
      reviewedAt: 1_777_000_000_000,
      candidateSchemaVersion: "ego_video_annotation_v1",
      candidatePolicyVersion: "ego_annotation_evidence_policy_v1",
      candidatePromptVersion: "ego_video_annotation_prompt_v1",
      candidatePromptContentSha256: "a".repeat(64),
    },
  };
}

describe("acceptedDeliveryAnnotation", () => {
  it("freezes a matching human-accepted candidate", () => {
    expect(acceptedDeliveryAnnotation(normalizedResult())).toMatchObject({
      schemaVersion: "ego_video_annotation_v1",
      promptVersion: "ego_video_annotation_prompt_v1",
      effective: { video_id: "SUB-1", tasks: [] },
      review: {
        reviewedByAccountId: "U-ADMIN",
        reason: "人工确认画面内容",
      },
    });
  });

  it.each([
    ["not reviewed", (value: ReturnType<typeof normalizedResult>) => {
      delete (value as { annotationReview?: unknown }).annotationReview;
    }],
    ["needs correction", (value: ReturnType<typeof normalizedResult>) => {
      value.annotationReview.decision = "needs_correction";
    }],
    ["stale review", (value: ReturnType<typeof normalizedResult>) => {
      value.annotationReview.candidatePromptContentSha256 = "b".repeat(64);
    }],
    ["validation errors", (value: ReturnType<typeof normalizedResult>) => {
      value.candidateAnnotation.validation.errors = ["invalid evidence"];
    }],
  ])("does not export a candidate that is %s", (_label, mutate) => {
    const value = normalizedResult();
    mutate(value);
    expect(acceptedDeliveryAnnotation(value)).toBeNull();
  });
});
