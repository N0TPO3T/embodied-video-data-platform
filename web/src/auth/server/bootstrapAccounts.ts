import type { AccountRecord } from "../contracts";
import { hashPassword } from "../password";
import { normalizeUsername } from "../validation";

export const initialAccountDefinitions = [
  ["U-ADMIN-01", "管理员", "admin", "admin123", "admin", undefined],
  [
    "U-LEAD-01",
    "团长1",
    "tuanzhang1",
    "tuanzhang1",
    "leader",
    "TEAM-01",
  ],
  [
    "U-LEAD-02",
    "团长2",
    "tuanzhang2",
    "tuanzhang2",
    "leader",
    "TEAM-02",
  ],
  [
    "U-COL-01",
    "测试人员1",
    "ceshirenyuan1",
    "ceshirenyuan1",
    "collector",
    "TEAM-01",
  ],
  [
    "U-COL-02",
    "测试人员2",
    "ceshirenyuan2",
    "ceshirenyuan2",
    "collector",
    "TEAM-02",
  ],
  [
    "U-COL-03",
    "测试人员3",
    "ceshirenyuan3",
    "ceshirenyuan3",
    "collector",
    "TEAM-01",
  ],
  [
    "U-COL-04",
    "测试人员4",
    "ceshirenyuan4",
    "ceshirenyuan4",
    "collector",
    "TEAM-01",
  ],
  [
    "U-COL-05",
    "测试人员5",
    "ceshirenyuan5",
    "ceshirenyuan5",
    "collector",
    "TEAM-01",
  ],
] as const;

export async function ensureInitialAccounts(
  repo: Pick<
    import("../contracts").AccountRepository,
    "isAccountTableEmpty" | "insertSeedAccounts"
  >,
  now = Date.now(),
): Promise<void> {
  if (!(await repo.isAccountTableEmpty())) return;

  const records: AccountRecord[] = await Promise.all(
    initialAccountDefinitions.map(
      async ([id, displayName, username, password, role, teamId]) => {
        const stored = await hashPassword(password);
        return {
          id,
          displayName,
          username,
          usernameNormalized: normalizeUsername(username),
          passwordHash: stored.hash,
          passwordSalt: stored.salt,
          passwordIterations: stored.iterations,
          role,
          teamId,
          status: "active",
          failedAttemptCount: 0,
          firstFailedAt: null,
          lockedUntil: null,
          createdAt: now,
          updatedAt: now,
        };
      },
    ),
  );

  await repo.insertSeedAccounts(records);
}
