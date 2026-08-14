import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getOperationsStatus,
  getQueueSnapshot,
  reclaimWorkerTimeouts,
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
});
