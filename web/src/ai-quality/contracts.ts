export type AiQualityPrompt = {
  id: string;
  revision: number;
  systemPrompt: string;
  contentSha256: string;
  promptVersion: string;
  ruleVersion: string;
  outputSchema: string;
  initialModel: string;
  reviewModel: string;
  createdByName: string;
  createdAt: number;
};

export type QualityRule = {
  id: string;
  revision: number;
  version: string;
  passThreshold: number;
  description: string;
  active: boolean;
  createdByAccountId: string;
  createdByName: string;
  createdAt: number;
};

export type CreateQualityRuleInput = {
  version: string;
  passThreshold: number;
  description: string;
};

export type LabelSetItem = {
  id: string;
  name: string;
  type: "scene" | "action" | "object" | "issue";
  associationCount: number;
  enabled: boolean;
};

export type LabelSet = {
  id: string;
  revision: number;
  version: string;
  labels: LabelSetItem[];
  active: boolean;
  createdByAccountId: string;
  createdByName: string;
  createdAt: number;
};

export type UpdateLabelInput = Pick<LabelSetItem, "id" | "name" | "enabled">;

export type CreateLabelInput = {
  name: string;
  type: LabelSetItem["type"];
  enabled: boolean;
};

export type ScarcityTier = {
  id: string;
  minCount: number;
  maxCount: number | null;
  coefficient: number;
  label: string;
};

export type ScarcityWeights = {
  scene: number;
  standardTask: number;
  variant: number;
};

export type ScarcityConfig = {
  id: string;
  revision: number;
  version: string;
  enabled: boolean;
  tiers: ScarcityTier[];
  weights: ScarcityWeights;
  description: string;
  createdByAccountId: string;
  createdByName: string;
  createdAt: number;
};

export type PublishScarcityConfigInput = {
  enabled: boolean;
  tiers: ScarcityTier[];
  weights: ScarcityWeights;
  description: string;
};
