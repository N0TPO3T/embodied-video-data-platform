import { describe, expect, it } from "vitest";
import {
  effectiveDuration,
  estimatePoints,
  isActivePassedSubmission,
  qualityCoefficient,
  qualityStatus,
} from "./calculations";
import type { Submission } from "./types";

describe("quality calculations", () => {
  it.each([
    [59, 0],
    [60, 0.7],
    [70, 0.85],
    [80, 1],
    [100, 1],
  ])("maps score %s to coefficient %s", (score, coefficient) => {
    expect(qualityCoefficient(score)).toBe(coefficient);
  });

  it("uses score 60 as the passing boundary", () => {
    expect(qualityStatus(59)).toBe("failed");
    expect(qualityStatus(60)).toBe("passed");
  });

  it("never returns a negative effective duration", () => {
    expect(effectiveDuration(90, 120)).toBe(0);
  });

  it("calculates points by rule, effective minutes, and coefficient", () => {
    expect(estimatePoints(12, 120, 30, 75)).toBe(15.3);
    expect(
      estimatePoints(12, 120, 30, 75, [
        { minScore: 0, maxScore: 100, ratio: 0.5 },
      ]),
    ).toBe(9);
  });

  it("excludes quarantined videos from ordinary asset candidates", () => {
    const submission = {
      processingStatus: "completed",
      qualityStatus: "passed",
      assetStatus: "quarantined",
    } as Submission;

    expect(isActivePassedSubmission(submission)).toBe(false);
    expect(
      isActivePassedSubmission({ ...submission, assetStatus: "active" }),
    ).toBe(true);
  });

  it("excludes unresolved near-duplicate candidates from ordinary asset candidates", () => {
    const submission = {
      processingStatus: "completed",
      qualityStatus: "passed",
      assetStatus: "active",
      duplicateCandidates: [
        {
          id: "DUP-01",
          candidateSubmissionId: "SUB-OLD",
          similarity: 0.96,
          status: "candidate",
          createdAt: "2026/08/13 10:00",
        },
      ],
    } as Submission;

    expect(isActivePassedSubmission(submission)).toBe(false);
    expect(
      isActivePassedSubmission({
        ...submission,
        duplicateCandidates: [
          { ...submission.duplicateCandidates![0]!, status: "cleared" },
        ],
      }),
    ).toBe(true);
  });
});
