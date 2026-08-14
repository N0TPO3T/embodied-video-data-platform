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
      pipelineStage: "awaiting_ai",
      qualityStatus: "pending",
      aiScore: 0,
      finalScore: 0,
      tags: ["测试数据"],
    });
  });

  it("maps persisted AI decisions using the final score pass threshold", () => {
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
        aiFinalScore: 57,
        rawTotalScore: 57,
        settlementRatio: 0.7,
        invalidDurationMs: 2_500,
        billableDurationMs: 7_500,
        summary: "服务端规则判定为可结算",
        recommendations: ["保持视角稳定"],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        reviewRevision: 2,
        manualIssues: [{ label: "人工确认遮挡", start: 4, end: 6 }],
        manualReview: {
          reviewedByAccountId: "U-ADMIN",
          reviewedByName: "管理员",
          reviewedAt: Date.parse("2026-08-11T02:00:00.000Z"),
          reason: "人工复核后调低",
          issues: [{ label: "人工确认遮挡", start: 4, end: 6 }],
          finalScore: 55,
        },
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
      qualityStatus: "failed",
      assetStatus: "active",
      aiScore: 57,
      finalScore: 55,
      qualityResult: {
        reviewRevision: 2,
        promptRevision: 3,
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        settlementRatio: 0.7,
        manualReview: {
          reviewedByName: "管理员",
          reason: "人工复核后调低",
          reviewedAt: "2026/08/11 10:00",
        },
      },
      issues: [{ label: "人工确认遮挡", start: 4, end: 6 }],
    });
  });

  it("keeps an unreviewed review-pending decision pending", () => {
    const submission = backendSubmissionToDomain({
      id: "SUB-REVIEW-PENDING",
      fileName: "review-pending.mp4",
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
        status: "review_pending",
        attempts: 1,
        promptRevision: 3,
        promptContentSha256: "a".repeat(64),
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        modelRuns: [],
        finalScore: 65,
        rawTotalScore: 65,
        settlementRatio: null,
        passed: null,
        passThreshold: 70,
        invalidDurationMs: 0,
        billableDurationMs: 10_000,
        summary: "等待人工确认",
        recommendations: [],
        deductions: [],
        reviewRequired: true,
        reviewReasons: ["边界分数需人工确认"],
        reviewRevision: 0,
        invalidSegments: [],
      },
    });

    expect(submission).toMatchObject({
      qualityStatus: "pending",
      qualityResult: {
        status: "review_pending",
        passed: null,
        passThreshold: 70,
      },
    });
  });

  it("maps quarantined submissions into tags and quarantine metadata", () => {
    const submission = backendSubmissionToDomain({
      id: "SUB-Q",
      fileName: "private.mp4",
      ownerId: "U-01",
      ownerName: "测试数采",
      teamId: "TEAM-01",
      teamName: "测试团队",
      sizeBytes: "1048576",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      isTestData: false,
      assetStatus: "quarantined",
      storageStatus: "deleted",
      storage: {
        status: "deleted",
        deletedAt: Date.parse("2026-08-11T03:00:00.000Z"),
        deletedByName: "管理员",
        deleteReason: "隐私请求删除",
      },
      quarantine: {
        reason: "画面包含隐私信息",
        quarantinedAt: Date.parse("2026-08-11T02:00:00.000Z"),
        quarantinedByName: "管理员",
      },
      createdAt: Date.parse("2026-08-11T01:02:03.000Z"),
      segments: [],
    });

    expect(submission).toMatchObject({
      assetStatus: "quarantined",
      storageStatus: "deleted",
      storage: {
        status: "deleted",
        deletedAt: "2026/08/11 11:00",
        deletedByName: "管理员",
        deleteReason: "隐私请求删除",
      },
      quarantine: {
        reason: "画面包含隐私信息",
        quarantinedAt: "2026/08/11 10:00",
        quarantinedByName: "管理员",
      },
      tags: ["敏感隔离", "对象已删除"],
    });
  });

  it("maps near-duplicate candidates into tags and settlement guards", () => {
    const submission = backendSubmissionToDomain({
      id: "SUB-DUP",
      fileName: "duplicate-shape.mp4",
      ownerId: "U-01",
      ownerName: "测试数采",
      teamId: "TEAM-01",
      teamName: "测试团队",
      sizeBytes: "1048576",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      settlementStatus: "unsettled",
      isTestData: false,
      duplicateCandidates: [
        {
          id: "DUP-01",
          candidateSubmissionId: "SUB-OLD",
          candidateFileName: "old-shape.mp4",
          similarity: 0.97,
          status: "candidate",
          createdAt: Date.parse("2026-08-11T03:00:00.000Z"),
        },
      ],
      createdAt: Date.parse("2026-08-11T01:02:03.000Z"),
      segments: [],
      quality: {
        status: "scored",
        attempts: 1,
        promptRevision: 1,
        promptContentSha256: "a".repeat(64),
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        modelRuns: [],
        finalScore: 88,
        rawTotalScore: 88,
        settlementRatio: 1,
        invalidDurationMs: 0,
        billableDurationMs: 60_000,
        summary: "通过",
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        invalidSegments: [],
      },
    });

    expect(submission.tags).toContain("疑似重复");
    expect(submission.duplicateCandidates?.[0]).toMatchObject({
      candidateFileName: "old-shape.mp4",
      similarity: 0.97,
      createdAt: "2026/08/11 11:00",
    });
  });
});
