import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPublicSiteSnapshot,
  publishPublicSiteSnapshot,
} from "./publicSiteApi";

describe("public site API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads and publishes anonymized public snapshots with credentials", async () => {
    const snapshot = {
      id: "PSS-1",
      revision: 1,
      snapshotDate: "2026-08-13",
      generatedByName: "系统初始化",
      generatedAt: 1,
      metrics: {
        deliverableVideoCount: 2,
        effectiveDurationSeconds: 165,
        sceneCount: 2,
        qualityPassRate: 66.67,
      },
      config: {
        primarySceneName: "家庭精细操作",
        primarySceneDescription: "厨房与桌面任务",
        ctaCopy: "为项目准备高质量数据",
      },
      sceneBreakdown: [],
      trend: [],
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ snapshot }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ snapshot: { ...snapshot, revision: 2 } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(getPublicSiteSnapshot()).resolves.toEqual(snapshot);
    await expect(
      publishPublicSiteSnapshot(snapshot.config),
    ).resolves.toMatchObject({ revision: 2 });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4000/api/v1/public-site/snapshot",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(snapshot.config),
      }),
    );
  });
});
