import type { AnnotationReviewEntity } from "../database/entities/annotation-review.entity.js";
import type { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";

export type AcceptedDeliveryAnnotation = {
  schemaVersion: string;
  policyVersion: string;
  promptVersion: string;
  promptContentSha256: string;
  model: string;
  source: "candidate" | "human_correction";
  effective: Record<string, unknown>;
  labelMappings: unknown[];
  review: {
    reviewedByAccountId: string;
    reviewedByName: string;
    reviewedAt: number;
    reason: string;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function acceptedAnnotationRun(
  run: AnnotationRunEntity | null | undefined,
  review: AnnotationReviewEntity | null | undefined,
): AcceptedDeliveryAnnotation | null {
  if (
    !run ||
    !review ||
    review.annotationRunId !== run.id ||
    run.executionStatus !== "succeeded" ||
    run.publicationStatus !== "human_verified" ||
    !["accepted_unchanged", "accepted_corrected"].includes(run.reviewStatus) ||
    review.revision !== run.reviewRevision ||
    review.disposition !== run.reviewStatus
  ) {
    return null;
  }
  const candidate = record(run.normalizedResult);
  if (
    !candidate ||
    candidate.schemaVersion !== run.schemaVersion ||
    candidate.policyVersion !== run.evidencePolicyVersion ||
    candidate.promptVersion !== run.promptVersion ||
    candidate.promptContentSha256 !== run.promptContentSha256 ||
    candidate.model !== run.model ||
    !nonEmptyString(run.schemaVersion) ||
    !nonEmptyString(run.evidencePolicyVersion) ||
    !nonEmptyString(run.systemPromptSnapshot) ||
    !record(run.outputExampleSnapshot)
  ) {
    return null;
  }
  const selected =
    run.reviewStatus === "accepted_corrected" ? record(run.humanResult) : candidate;
  if (!selected) return null;
  if (
    run.reviewStatus === "accepted_unchanged" &&
    (run.humanResult !== null || review.correctedResult !== null)
  ) {
    return null;
  }
  if (
    run.reviewStatus === "accepted_corrected" &&
    (selected.source !== "human_correction" ||
      selected.schemaVersion !== run.schemaVersion ||
      selected.policyVersion !== run.evidencePolicyVersion ||
      JSON.stringify(review.correctedResult) !== JSON.stringify(run.humanResult))
  ) {
    return null;
  }
  const validation = record(selected.validation);
  const effective = record(selected.effective);
  if (
    !validation ||
    !Array.isArray(validation.errors) ||
    validation.errors.length > 0 ||
    !effective ||
    !Array.isArray(selected.labelMappings) ||
    !nonEmptyString(run.promptVersion) ||
    !nonEmptyString(run.promptContentSha256) ||
    !/^[a-f0-9]{64}$/u.test(run.promptContentSha256) ||
    !nonEmptyString(run.model) ||
    !nonEmptyString(review.reviewerAccountId) ||
    !nonEmptyString(review.reviewerName) ||
    !Number.isFinite(review.createdAt.getTime())
  ) {
    return null;
  }
  return {
    schemaVersion: run.schemaVersion,
    policyVersion: run.evidencePolicyVersion,
    promptVersion: run.promptVersion,
    promptContentSha256: run.promptContentSha256,
    model: run.model,
    source:
      run.reviewStatus === "accepted_corrected" ? "human_correction" : "candidate",
    effective,
    labelMappings: selected.labelMappings,
    review: {
      reviewedByAccountId: review.reviewerAccountId,
      reviewedByName: review.reviewerName,
      reviewedAt: review.createdAt.getTime(),
      reason: review.reason,
    },
  };
}
