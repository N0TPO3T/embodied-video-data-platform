import type {
  AccountAuditLog,
  AccountPublic,
  AccountRecord,
} from "../contracts";

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

export function makeAccountRecord(
  overrides: Partial<AccountRecord> = {},
): AccountRecord {
  return {
    ...makeAccountPublic(),
    usernameNormalized: "test.user",
    passwordHash: "hash",
    passwordSalt: "salt",
    passwordIterations: 600_000,
    failedAttemptCount: 0,
    firstFailedAt: null,
    lockedUntil: null,
    createdAt: 10,
    ...overrides,
  };
}

export function makeAudit(target: AccountRecord): AccountAuditLog {
  return {
    id: `AUD-${target.id}`,
    actorAccountId: "U-ADMIN-01",
    actorName: "管理员",
    action: "create",
    targetAccountId: target.id,
    targetName: target.displayName,
    summary: "创建账号",
    createdAt: 10,
  };
}

export function makeResetAudit(target: AccountRecord): AccountAuditLog {
  return {
    ...makeAudit(target),
    id: `AUD-RESET-${target.id}`,
    action: "reset_password",
  };
}
