import { stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseQualityLabEnvironment } from "../quality-lab/environment.js";
import { VideoQualityMediaPreprocessor } from "../video-quality/media-preprocessor.js";
import { loadVideoQualityPrompt } from "../video-quality/prompt-loader.js";
import { QwenVideoQualityProvider } from "../video-quality/qwen-video-quality.provider.js";
import { VideoQualityService } from "../video-quality/video-quality.service.js";

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  const confirmed = argumentsList.includes("--confirm-paid-call");
  const rawPath = argumentsList.find((argument) => !argument.startsWith("--"));
  if (!confirmed || !rawPath) {
    throw new Error(
      "用法：quality:smoke <精确视频路径> --confirm-paid-call（会产生百炼费用）",
    );
  }
  const filePath = resolve(rawPath);
  const file = await stat(filePath);
  if (!file.isFile()) throw new Error("冒烟测试参数必须是单个视频文件");

  const environment = parseQualityLabEnvironment(process.env);
  if (!environment.qwenApiKey) throw new Error("QWEN_API_KEY 尚未配置");
  const prompt = await loadVideoQualityPrompt(environment.promptPath);
  if (
    prompt.initialModel !== environment.initialModel ||
    prompt.reviewModel !== environment.reviewModel
  ) {
    throw new Error("模型环境变量与提示词固定模型不一致");
  }
  const service = new VideoQualityService({
    preprocessor: new VideoQualityMediaPreprocessor(),
    provider: new QwenVideoQualityProvider({
      config: {
        apiKey: environment.qwenApiKey,
        baseUrl: environment.qwenBaseUrl,
        initialModel: environment.initialModel,
        reviewModel: environment.reviewModel,
        timeoutMs: environment.modelTimeoutMs,
      },
      prompt,
    }),
  });
  const workDirectory = await mkdtemp(join(tmpdir(), "evdp-quality-smoke-"));
  try {
    const result = await service.evaluate(
      {
        videoId: `SMOKE-${Date.now()}`,
        filePath,
        workDirectory,
        registerSha256: () => false,
      },
      (stage) => process.stderr.write(`stage=${stage}\n`),
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          evaluationStatus: result.evaluationStatus,
          finalScore: result.finalScore,
          settlementRatio: result.settlementRatio,
          billableDurationMs: result.billableDurationMs,
          reviewRequired: result.reviewRequired,
          validationErrors: result.validation.errors,
          modelRuns: result.modelRuns.map((run) => ({
            stage: run.stage,
            model: run.model,
            requestId: run.requestId,
            durationMs: run.durationMs,
            frameCount: run.frameCount,
          })),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown";
  process.stderr.write(`视频质检冒烟测试失败：${message}\n`);
  process.exitCode = 1;
});
