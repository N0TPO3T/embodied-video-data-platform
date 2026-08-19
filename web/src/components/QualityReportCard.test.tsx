import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Submission } from "../domain/types";
import { QualityReportCard } from "./QualityReportCard";

function makeSubmission(overrides: Partial<Submission>): Submission {
  return {
    id: "SUB-test",
    fileName: "test.mp4",
    ownerId: "U-COL-01",
    ownerName: "数采人员1",
    teamId: "TEAM-01",
    teamName: "一队",
    scene: "抓取",
    action: "拿取",
    object: "水杯",
    durationSeconds: 64.333,
    invalidSeconds: 0,
    sizeMb: 30,
    resolution: "854x480",
    processingStatus: "completed",
    qualityStatus: "passed",
    aiScore: 86.5,
    finalScore: 86.5,
    issues: [],
    qualityResult: {
      status: "scored",
      summary: "质量通过",
      recommendations: [],
      reviewReasons: [],
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      promptRevision: 1,
      promptContentSha256: "abc",
      settlementRatio: 1,
      passThreshold: 80,
      reviewRevision: 0,
      attempts: 1,
      dimensions: {},
    },
    settlementStatus: "unsettled",
    createdAt: "2026-08-19T08:39:56Z",
    tags: [],
    audit: [],
    ...overrides,
  };
}

describe("QualityReportCard", () => {
  it("shows effective and invalid durations precisely so they add up to the total", () => {
    render(
      <QualityReportCard
        submission={makeSubmission({})}
        pointsLabel="3.22 分"
        evidenceByRange={new Map()}
      />,
    );

    // 64.333s - 0s invalid = 64s effective; must not round down to "1 分钟"
    expect(screen.getByText("1分04秒")).toBeInTheDocument();
    expect(screen.getByText("0秒")).toBeInTheDocument();
  });

  it("deducts invalid duration from effective duration", () => {
    render(
      <QualityReportCard
        submission={makeSubmission({
          durationSeconds: 120,
          invalidSeconds: 10,
        })}
        pointsLabel="5.50 分"
        evidenceByRange={new Map()}
      />,
    );

    expect(screen.getByText("1分50秒")).toBeInTheDocument();
    expect(screen.getByText("10秒")).toBeInTheDocument();
  });
});
