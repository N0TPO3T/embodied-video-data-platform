// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseInitialAccountPasswords } from "./initialCredentials";

const usernames = ["admin", "leader.one"] as const;
const validCredentials = {
  admin: "test-password-admin",
  "leader.one": "test-password-leader",
};

describe("initial account credentials", () => {
  it("parses one valid private password for every initial username", () => {
    expect(
      parseInitialAccountPasswords(
        JSON.stringify(validCredentials),
        usernames,
      ),
    ).toEqual(validCredentials);
  });

  it.each([
    ["missing", undefined],
    ["malformed", "{"],
    ["incomplete", JSON.stringify({ admin: "test-password-admin" })],
    [
      "extra username",
      JSON.stringify({ ...validCredentials, extra: "test-password-extra" }),
    ],
    [
      "short password",
      JSON.stringify({ ...validCredentials, admin: "short" }),
    ],
    [
      "long password",
      JSON.stringify({ ...validCredentials, admin: "x".repeat(65) }),
    ],
  ])("rejects %s configuration without exposing its contents", (_, raw) => {
    expect(() =>
      parseInitialAccountPasswords(raw, usernames),
    ).toThrowError("初始账号密码配置无效");
  });
});
