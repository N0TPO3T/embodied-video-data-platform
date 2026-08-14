import type { QualityStatus, Submission } from "./types";

export type QualityCoefficientBand = {
  minScore: number;
  maxScore: number;
  ratio: number;
};

const DEFAULT_QUALITY_BANDS: QualityCoefficientBand[] = [
  { minScore: 80, maxScore: 100, ratio: 1 },
  { minScore: 70, maxScore: 79, ratio: 0.85 },
  { minScore: 60, maxScore: 69, ratio: 0.7 },
  { minScore: 0, maxScore: 59, ratio: 0 },
];

export function qualityCoefficient(
  score: number,
  bands: readonly QualityCoefficientBand[] = DEFAULT_QUALITY_BANDS,
): number {
  const band = [...bands]
    .sort((left, right) => right.minScore - left.minScore)
    .find(
      (candidate) =>
        score >= candidate.minScore &&
        (candidate.maxScore >= 100 || score < candidate.maxScore + 1),
    );
  if (band) return band.ratio;
  if (score < 60) return 0;
  if (score < 70) return 0.7;
  if (score < 80) return 0.85;
  return 1;
}

export function qualityStatus(
  score: number,
  passThreshold = 60,
): QualityStatus {
  return score >= passThreshold ? "passed" : "failed";
}

export function effectiveDuration(
  durationSeconds: number,
  invalidSeconds: number,
): number {
  return Math.max(0, durationSeconds - invalidSeconds);
}

export function estimatePoints(
  pointsPerMinute: number,
  durationSeconds: number,
  invalidSeconds: number,
  score: number,
  bands?: readonly QualityCoefficientBand[],
): number {
  const points =
    pointsPerMinute *
    (effectiveDuration(durationSeconds, invalidSeconds) / 60) *
    qualityCoefficient(score, bands);

  return Math.round(points * 100) / 100;
}

export function isActivePassedSubmission(item: Submission): boolean {
  return (
    item.processingStatus === "completed" &&
    item.qualityStatus === "passed" &&
    item.assetStatus !== "quarantined" &&
    !item.duplicateCandidates?.some(
      (candidate) => candidate.status === "candidate",
    )
  );
}
