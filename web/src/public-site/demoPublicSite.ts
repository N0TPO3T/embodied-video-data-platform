import type { PublicSiteSnapshot } from "./contracts";

export const demoPublicSiteSnapshot: PublicSiteSnapshot = {
  id: "PUBLIC-DEMO",
  revision: 1,
  snapshotDate: "2026-08-13",
  generatedByName: "演示数据",
  generatedAt: Date.parse("2026-08-13T00:00:00.000Z"),
  metrics: {
    deliverableVideoCount: 86_420,
    effectiveDurationSeconds: 2_864 * 3_600,
    sceneCount: 42,
    qualityPassRate: 94.8,
  },
  config: {
    primarySceneName: "家庭精细操作",
    primarySceneDescription: "31,280 条可交付视频",
    ctaCopy: "为你的具身智能项目准备下一批高质量数据",
  },
  sceneBreakdown: [
    {
      name: "工具使用",
      description: "组装 · 维修 · 园艺",
      videoCount: 20_741,
      share: 24,
    },
    {
      name: "家务任务",
      description: "烹饪 · 清洁 · 收纳",
      videoCount: 32_840,
      share: 38,
    },
    {
      name: "物流操作",
      description: "分类 · 包装 · 搬运",
      videoCount: 16_420,
      share: 19,
    },
    {
      name: "办公协作",
      description: "文档 · 设备 · 物品归位",
      videoCount: 16_419,
      share: 19,
    },
  ],
  trend: [
    { label: "08-02", value: 34 },
    { label: "08-03", value: 52 },
    { label: "08-04", value: 43 },
    { label: "08-05", value: 68 },
    { label: "08-06", value: 57 },
    { label: "08-07", value: 76 },
    { label: "08-08", value: 71 },
    { label: "08-09", value: 88 },
    { label: "08-10", value: 82 },
    { label: "08-11", value: 96 },
    { label: "08-12", value: 90 },
    { label: "08-13", value: 104 },
  ],
};
