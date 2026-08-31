import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateTaskSegments,
  getOperationsStatus,
  getQueueSnapshot,
  getTaskSegmentAssets,
  getTaskSegmentPreview,
  reclaimWorkerTimeouts,
  retryTaskSegment,
} from "./operationsApi";

describe("operations API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads queue and status snapshots with credentials", async () => {
    const queue = {
      summary: {
        total: 0,
        pending: 0,
        published: 0,
        failed: 0,
        media: 0,
        ai: 0,
        averagePublishLatencyMs: 0,
      },
      jobs: [],
      workers: [],
    };
    const status = {
      generatedAt: 1,
      unreadCount: 1,
      summary: {
        processingSubmissions: 1,
        failedSubmissions: 0,
        reviewPending: 1,
        unsettledEligible: 0,
        pendingJobs: 0,
        failedJobs: 0,
        workerAlerts: 0,
        recentAudits: 0,
      },
      navigationBadges: [{ path: "/admin/review", label: "1", count: 1 }],
      notifications: [
        {
          id: "admin-review-1",
          title: "有视频等待人工复核",
          detail: "1 条终态质检结果需要平台确认。",
          tone: "warning",
          path: "/admin/review",
          count: 1,
          createdAt: 1,
        },
      ],
    };
    const reclaim = {
      reclaimed: [
        {
          submissionId: "SUB-OPS-TIMEOUT",
          previousStatus: "ai_processing",
          nextStatus: "awaiting_ai",
          eventType: "ai.quality.v1",
        },
      ],
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(queue), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(status), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(reclaim), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(getQueueSnapshot()).resolves.toEqual(queue);
    await expect(getOperationsStatus()).resolves.toEqual(status);
    await expect(reclaimWorkerTimeouts()).resolves.toEqual(reclaim);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4000/api/v1/operations/status",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "http://localhost:4000/api/v1/operations/workers/reclaim-timeouts",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("uses the admin task-segment generate, list, retry and preview routes", async () => {
    const generate = {
      annotationRunId: "RUN/SEG",
      taskCount: 2,
      created: 2,
      existing: 0,
      skipped: 0,
    };
    const list = {
      assets: [],
      pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    };
    const retried = { asset: { id: "TSA/1" } };
    const preview = {
      assetId: "TSA/1",
      url: "https://storage.test/clip.mp4",
      contentType: "video/mp4",
      expiresAt: 123,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(generate), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(list), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(retried), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(generateTaskSegments("RUN/SEG")).resolves.toEqual(generate);
    await expect(getTaskSegmentAssets({ annotationRunId: "RUN/SEG" })).resolves.toEqual(list);
    await expect(retryTaskSegment("TSA/1")).resolves.toEqual(retried);
    await expect(getTaskSegmentPreview("TSA/1")).resolves.toEqual(preview);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "http://localhost:4000/api/v1/operations/annotation-runs/RUN%2FSEG/task-segments/generate",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4000/api/v1/operations/task-segment-assets?annotationRunId=RUN%2FSEG&page=1&pageSize=50",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "http://localhost:4000/api/v1/operations/task-segment-assets/TSA%2F1/retry",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      "http://localhost:4000/api/v1/operations/task-segment-assets/TSA%2F1/preview",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
