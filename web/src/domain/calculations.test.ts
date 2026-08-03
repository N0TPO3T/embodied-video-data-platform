import { describe, expect, it } from "vitest";
import {
  effectiveDuration,
  estimateIncome,
  qualityCoefficient,
  qualityStatus,
  validateWithdrawal,
} from "./calculations";

describe("quality calculations", () => {
  it.each([
    [59, 0],
    [60, 0.7],
    [70, 0.85],
    [80, 1],
    [100, 1],
  ])("maps score %s to coefficient %s", (score, coefficient) => {
    expect(qualityCoefficient(score)).toBe(coefficient);
  });

  it("uses score 60 as the passing boundary", () => {
    expect(qualityStatus(59)).toBe("failed");
    expect(qualityStatus(60)).toBe("passed");
  });

  it("never returns a negative effective duration", () => {
    expect(effectiveDuration(90, 120)).toBe(0);
  });

  it("calculates income by price, effective minutes, and coefficient", () => {
    expect(estimateIncome(12, 120, 30, 75)).toBe(15.3);
  });
});

describe("withdrawal validation", () => {
  it("rejects amounts below the minimum", () => {
    expect(validateWithdrawal(80, 500, 100)).toEqual({
      valid: false,
      message: "最低提现金额为 ¥100",
    });
  });

  it("rejects amounts above the available balance", () => {
    expect(validateWithdrawal(600, 500, 100)).toEqual({
      valid: false,
      message: "提现金额不能超过可用余额",
    });
  });

  it("accepts an amount within the available range", () => {
    expect(validateWithdrawal(200, 500, 100)).toEqual({
      valid: true,
      message: "",
    });
  });
});
