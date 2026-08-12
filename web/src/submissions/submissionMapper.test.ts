import { describe, expect, it } from "vitest";

import { backendSubmissionToDomain } from "./submissionMapper";

describe("backend submission mapping", () => {
  it("formats submission times in Asia/Shanghai regardless of the runtime timezone", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "UTC";

    try {
      const submission = backendSubmissionToDomain({
        id: "SUB-TIMEZONE",
        fileName: "timezone.mp4",
        ownerId: "U-01",
        ownerName: "测试数采",
        teamId: "TEAM-01",
        teamName: "测试团队",
        sizeBytes: "1048576",
        uploadStatus: "uploaded",
        processingStatus: "queued",
        isTestData: false,
        createdAt: Date.parse("2026-08-11T11:00:00.000Z"),
        segments: [],
      });

      expect(submission.createdAt).toBe("2026/08/11 19:00");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("maps media state and unions overlapping invalid intervals", () => {
    const submission = backendSubmissionToDomain({
      id: "SUB-01",
      fileName: "task.mp4",
      ownerId: "U-01",
      ownerName: "测试数采",
      teamId: "TEAM-01",
      teamName: "测试团队",
      sizeBytes: "10485760",
      uploadStatus: "uploaded",
      processingStatus: "awaiting_ai",
      isTestData: true,
      createdAt: Date.parse("2026-08-11T01:02:03.000Z"),
      media: {
        durationSeconds: 120,
        width: 1920,
        height: 1080,
        frameRate: 59.94,
        codec: "h264",
        bitrate: "8000000",
        sizeBytes: "10485760",
      },
      segments: [
        { id: "SEG-1", type: "black", startSeconds: 0, endSeconds: 5, invalid: true },
        { id: "SEG-2", type: "freeze", startSeconds: 4, endSeconds: 8, invalid: true },
      ],
    });

    expect(submission).toMatchObject({
      id: "SUB-01",
      durationSeconds: 120,
      invalidSeconds: 8,
      sizeMb: 10,
      resolution: "1920×1080",
      processingStatus: "processing",
      qualityStatus: "pending",
      aiScore: 0,
      finalScore: 0,
      tags: ["测试数据"],
    });
  });

  it("maps persisted AI decisions without applying a 60-point threshold", () => {
    const submission = backendSubmissionToDomain({
      id: "SUB-AI",
      fileName: "ai.mp4",
      ownerId: "U-01",
      ownerName: "测试数采",
      teamId: "TEAM-01",
      teamName: "测试团队",
      sizeBytes: "1048576",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      isTestData: false,
      createdAt: Date.parse("2026-08-11T01:02:03.000Z"),
      segments: [],
      quality: {
        status: "scored",
        attempts: 1,
        promptRevision: 3,
        promptContentSha256: "a".repeat(64),
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        modelRuns: [],
        finalScore: 55,
        rawTotalScore: 57,
        settlementRatio: 0.7,
        invalidDurationMs: 2_500,
        billableDurationMs: 7_500,
        summary: "服务端规则判定为可结算",
        recommendations: ["保持视角稳定"],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        detectedTask: {
          scene_id: "kitchen",
          task_id: "tidy",
          variant_id: "v1",
          task_summary: "整理厨房台面",
        },
        invalidSegments: [],
      },
    });

    expect(submission).toMatchObject({
      scene: "kitchen",
      action: "整理厨房台面",
      object: "v1",
      invalidSeconds: 2.5,
      qualityStatus: "passed",
      aiScore: 55,
      finalScore: 55,
      qualityResult: {
        promptRevision: 3,
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        settlementRatio: 0.7,
      },
    });
  });
});
