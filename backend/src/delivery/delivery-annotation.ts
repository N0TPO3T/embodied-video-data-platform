import {
  LEGACY_VIDEO_ANNOTATION_POLICY_VERSION,
  LEGACY_VIDEO_ANNOTATION_SCHEMA_VERSION,
  VIDEO_ANNOTATION_POLICY_VERSION,
  VIDEO_ANNOTATION_SCHEMA_VERSION,
} from "../video-annotation/video-annotation.js";
import type { AnnotationReviewEntity } from "../database/entities/annotation-review.entity.js";
import type { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";

type DeliveryAnnotationSchemaVersion =
  | typeof VIDEO_ANNOTATION_SCHEMA_VERSION
  | typeof LEGACY_VIDEO_ANNOTATION_SCHEMA_VERSION;
type DeliveryAnnotationPolicyVersion =
  | typeof VIDEO_ANNOTATION_POLICY_VERSION
  | typeof LEGACY_VIDEO_ANNOTATION_POLICY_VERSION;

export type AcceptedDeliveryAnnotation = {
  schemaVersion: DeliveryAnnotationSchemaVersion;
  policyVersion: DeliveryAnnotationPolicyVersion;
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
  let schemaVersion: DeliveryAnnotationSchemaVersion;
  let policyVersion: DeliveryAnnotationPolicyVersion;
  if (
    candidate.schemaVersion === VIDEO_ANNOTATION_SCHEMA_VERSION &&
    candidate.policyVersion === VIDEO_ANNOTATION_POLICY_VERSION
  ) {
    schemaVersion = VIDEO_ANNOTATION_SCHEMA_VERSION;
    policyVersion = VIDEO_ANNOTATION_POLICY_VERSION;
  } else if (
    candidate.schemaVersion === LEGACY_VIDEO_ANNOTATION_SCHEMA_VERSION &&
    candidate.policyVersion === LEGACY_VIDEO_ANNOTATION_POLICY_VERSION
  ) {
    schemaVersion = LEGACY_VIDEO_ANNOTATION_SCHEMA_VERSION;
    policyVersion = LEGACY_VIDEO_ANNOTATION_POLICY_VERSION;
  } else {
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
  const correctedAnnotation = record(review.correctedAnnotation);
  const selectedArtifact = correctedAnnotation ?? candidate;
  const validation = record(selectedArtifact.validation);
  if (!validation || !Array.isArray(validation.errors) || validation.errors.length > 0) {
    return null;
  }
  if (correctedAnnotation) {
    if (
      correctedAnnotation.source !== "human_correction" ||
      correctedAnnotation.schemaVersion !== VIDEO_ANNOTATION_SCHEMA_VERSION ||
      correctedAnnotation.policyVersion !== VIDEO_ANNOTATION_POLICY_VERSION
    ) {
      return null;
    }
    schemaVersion = VIDEO_ANNOTATION_SCHEMA_VERSION;
    policyVersion = VIDEO_ANNOTATION_POLICY_VERSION;
  }
  const effective = record(selectedArtifact.effective);
  const labelMappings = selectedArtifact.labelMappings;
  if (
    !effective ||
    !Array.isArray(labelMappings) ||
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
    schemaVersion,
    policyVersion,
    promptVersion: candidate.promptVersion,
    promptContentSha256: candidate.promptContentSha256,
    model: candidate.model,
    source: correctedAnnotation ? "human_correction" : "candidate",
    effective,
    labelMappings,
    review: {
      reviewedByAccountId: review.reviewedByAccountId,
      reviewedByName: review.reviewedByName,
      reviewedAt: review.reviewedAt,
      reason: typeof review.reason === "string" ? review.reason : "",
    },
  };
}

export function acceptedAnnotationRun(
  run: AnnotationRunEntity | null | undefined,
  review: AnnotationReviewEntity | null | undefined,
): AcceptedDeliveryAnnotation | null {
  if (
    !run ||
    !review ||
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
    candidate.schemaVersion !== VIDEO_ANNOTATION_SCHEMA_VERSION ||
    candidate.policyVersion !== VIDEO_ANNOTATION_POLICY_VERSION ||
    candidate.promptVersion !== run.promptVersion ||
    candidate.promptContentSha256 !== run.promptContentSha256 ||
    candidate.model !== run.model
  ) {
    return null;
  }
  const selected =
    run.reviewStatus === "accepted_corrected" ? record(run.humanResult) : candidate;
  if (!selected) return null;
  if (
    run.reviewStatus === "accepted_corrected" &&
    (selected.source !== "human_correction" ||
      selected.schemaVersion !== VIDEO_ANNOTATION_SCHEMA_VERSION ||
      selected.policyVersion !== VIDEO_ANNOTATION_POLICY_VERSION)
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
    !nonEmptyString(run.model)
  ) {
    return null;
  }
  return {
    schemaVersion: VIDEO_ANNOTATION_SCHEMA_VERSION,
    policyVersion: VIDEO_ANNOTATION_POLICY_VERSION,
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
