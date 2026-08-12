import type { AccountPublic } from "./contracts";

export function makeAccountPublic(
  overrides: Partial<AccountPublic> = {},
): AccountPublic {
  return {
    id: "U-TEST",
    displayName: "测试用户",
    username: "test.user",
    role: "collector",
    teamId: "TEAM-01",
    status: "active",
    updatedAt: 10,
    ...overrides,
  };
}
