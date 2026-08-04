import { describe, expect, it } from "vitest";
import {
  normalizeUsername,
  validateAccountFields,
  validatePassword,
} from "./validation";

describe("account validation", () => {
  it("normalizes usernames for case-insensitive uniqueness", () => {
    expect(normalizeUsername("  Test.User_1 ")).toBe("test.user_1");
  });

  it("rejects invalid usernames and passwords", () => {
    expect(() => normalizeUsername("测试用户")).toThrow(
      "用户名需为 3 到 32 位字母、数字、点、下划线或连字符",
    );
    expect(() => validatePassword("short")).toThrow(
      "密码长度需为 8 到 64 位",
    );
  });

  it("requires a team only for leaders and collectors", () => {
    expect(
      validateAccountFields({
        displayName: "新管理员",
        username: "admin.two",
        role: "admin",
      }),
    ).toMatchObject({ teamId: undefined });

    expect(() =>
      validateAccountFields({
        displayName: "测试人员6",
        username: "ceshirenyuan6",
        role: "collector",
      }),
    ).toThrow("请选择有效团队");
  });
});
