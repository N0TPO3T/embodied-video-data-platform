import { describe, expect, it } from "vitest";

import { DEFAULT_SCARCITY_TIERS } from "../src/ai-quality/scarcity-config.service.js";
import { InventoryService } from "../src/ai-quality/inventory.service.js";

describe("InventoryService.coefficientForCount", () => {
  const service = {
    coefficientForCount: (count: number) =>
      new InventoryService(
        {} as never,
        {} as never,
      ).coefficientForCount(count, DEFAULT_SCARCITY_TIERS),
  };

  it("maps scarce scenes to high coefficients", () => {
    expect(service.coefficientForCount(0)).toBe(1);
    expect(service.coefficientForCount(1)).toBe(1);
    expect(service.coefficientForCount(5)).toBe(1);
  });

  it("maps medium and saturated scenes to lower coefficients", () => {
    expect(service.coefficientForCount(6)).toBe(0.9);
    expect(service.coefficientForCount(20)).toBe(0.9);
    expect(service.coefficientForCount(21)).toBe(0.75);
    expect(service.coefficientForCount(50)).toBe(0.75);
    expect(service.coefficientForCount(51)).toBe(0.6);
    expect(service.coefficientForCount(100)).toBe(0.6);
  });

  it("treats the unbounded top tier as saturated", () => {
    expect(service.coefficientForCount(101)).toBe(0.5);
    expect(service.coefficientForCount(10_000)).toBe(0.5);
  });
});
