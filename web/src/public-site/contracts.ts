export type PublicSiteScene = {
  name: string;
  description: string;
  videoCount: number;
  share: number;
};

export type PublicSiteTrendPoint = {
  label: string;
  value: number;
};

export type PublicSiteSnapshot = {
  id: string;
  revision: number;
  snapshotDate: string;
  generatedByName: string;
  generatedAt: number;
  metrics: {
    deliverableVideoCount: number;
    effectiveDurationSeconds: number;
    sceneCount: number;
    qualityPassRate: number;
  };
  config: {
    primarySceneName: string;
    primarySceneDescription: string;
    ctaCopy: string;
  };
  sceneBreakdown: PublicSiteScene[];
  trend: PublicSiteTrendPoint[];
};

export type UpdatePublicSiteConfigInput = PublicSiteSnapshot["config"];
