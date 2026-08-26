import { describe, expect, it } from "vitest";

import {
  aiAnnotationConcurrency,
  aiAnnotationModelTimeoutMs,
  aiAnnotationSampleRate,
  aiAnnotationShadowEnabled,
} from "../src/ai-quality/ai-quality.config.js";

describe("AI annotation rollout config", () => {
  it("defaults to an off, ten-percent, single-call rollout", () => {
    expect(aiAnnotationShadowEnabled(undefined)).toBe(false);
    expect(aiAnnotationSampleRate(undefined)).toBe(0.1);
    expect(aiAnnotationConcurrency(undefined)).toBe(1);
    expect(aiAnnotationModelTimeoutMs(undefined)).toBe(180_000);
  });

  it("rejects unsafe rollout values", () => {
    expect(() => aiAnnotationSampleRate("1.1")).toThrow(/0 到 1/u);
    expect(() => aiAnnotationConcurrency("0")).toThrow(/1 到 8/u);
    expect(() => aiAnnotationModelTimeoutMs("9999")).toThrow(/10000/u);
    expect(() => aiAnnotationShadowEnabled("perhaps")).toThrow(/true 或 false/u);
  });
});
