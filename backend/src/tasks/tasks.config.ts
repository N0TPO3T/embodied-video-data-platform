export function taskRequirementNormalizerModel(): string {
  return (
    process.env.TASK_REQUIREMENT_NORMALIZER_MODEL?.trim() || "qwen3.7-plus"
  );
}

export function taskRequirementNormalizerTimeoutMs(): number {
  const parsed = Number(
    process.env.TASK_REQUIREMENT_NORMALIZER_TIMEOUT_MS?.trim() || 120_000,
  );
  if (!Number.isFinite(parsed) || parsed < 10_000 || parsed > 600_000) {
    throw new Error(
      "TASK_REQUIREMENT_NORMALIZER_TIMEOUT_MS 必须是 10000 到 600000 之间的整数",
    );
  }
  return parsed;
}

export function qwenApiKey(): string {
  return process.env.QWEN_API_KEY?.trim() ?? "";
}

export function qwenBaseUrl(): string {
  return process.env.QWEN_BASE_URL?.trim() ?? "";
}
