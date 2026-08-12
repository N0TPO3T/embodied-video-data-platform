import type { LoadedVideoQualityPrompt } from "../video-quality/prompt-loader.js";
import type { VideoQualityService } from "../video-quality/video-quality.service.js";

export const AI_QUALITY_EVALUATOR_FACTORY = Symbol(
  "AI_QUALITY_EVALUATOR_FACTORY",
);

export type AiQualityEvaluatorFactory = (
  prompt: LoadedVideoQualityPrompt,
) => Pick<VideoQualityService, "evaluate">;
