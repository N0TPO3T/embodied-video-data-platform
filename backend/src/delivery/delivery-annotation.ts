import {
  VIDEO_ANNOTATION_POLICY_VERSION,
  VIDEO_ANNOTATION_SCHEMA_VERSION,
} from "../video-annotation/video-annotation.js";

export type AcceptedDeliveryAnnotation = {
  schemaVersion: typeof VIDEO_ANNOTATION_SCHEMA_VERSION;
  policyVersion: typeof VIDEO_ANNOTATION_POLICY_VERSION;
  promptVersion: string;
  promptContentSha256: string;
  model: string;
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

/**
 * Delivery is a trust boundary: only a human-accepted, internally consistent
 * candidate can become a frozen downstream annotation artifact.
 */
export function acceptedDeliveryAnnotation(
  normalizedResult: Record<string, unknown> | null | undefined,
): AcceptedDeliveryAnnotation | null {
  const candidate = record(normalizedResult?.candidateAnnotation);
  const review = record(normalizedResult?.annotationReview);
  if (!candidate || !review || review.decision !== "accepted") return null;
  if (!["candidate", "review_required"].includes(String(candidate.status))) {
    return null;
  }
  if (
    candidate.schemaVersion !== VIDEO_ANNOTATION_SCHEMA_VERSION ||
    candidate.policyVersion !== VIDEO_ANNOTATION_POLICY_VERSION
  ) {
    return null;
  }
  if (
    review.candidateSchemaVersion !== candidate.schemaVersion ||
    review.candidatePolicyVersion !== candidate.policyVersion ||
    review.candidatePromptVersion !== candidate.promptVersion ||
    review.candidatePromptContentSha256 !== candidate.promptContentSha256
  ) {
    return null;
  }
  const validation = record(candidate.validation);
  if (
    !validation ||
    !Array.isArray(validation.errors) ||
    validation.errors.length > 0
  ) {
    return null;
  }
  const effective = record(candidate.effective);
  if (
    !effective ||
    !Array.isArray(candidate.labelMappings) ||
    !nonEmptyString(candidate.promptVersion) ||
    !nonEmptyString(candidate.promptContentSha256) ||
    !nonEmptyString(candidate.model) ||
    !nonEmptyString(review.reviewedByAccountId) ||
    !nonEmptyString(review.reviewedByName) ||
    typeof review.reviewedAt !== "number" ||
    !Number.isFinite(review.reviewedAt)
  ) {
    return null;
  }

  return {
    schemaVersion: VIDEO_ANNOTATION_SCHEMA_VERSION,
    policyVersion: VIDEO_ANNOTATION_POLICY_VERSION,
    promptVersion: candidate.promptVersion,
    promptContentSha256: candidate.promptContentSha256,
    model: candidate.model,
    effective,
    labelMappings: candidate.labelMappings,
    review: {
      reviewedByAccountId: review.reviewedByAccountId,
      reviewedByName: review.reviewedByName,
      reviewedAt: review.reviewedAt,
      reason: typeof review.reason === "string" ? review.reason : "",
    },
  };
}
