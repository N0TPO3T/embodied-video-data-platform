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
