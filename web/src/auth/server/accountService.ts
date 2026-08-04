import type {
  AccountAuditLog,
  AccountPublic,
  AccountRecord,
  AccountRepository,
  CreateAccountInput,
  UpdateAccountInput,
} from "../contracts";
import type { AccountStatus, Role } from "../../domain/types";
import { hashPassword } from "../password";
import {
  normalizeUsername,
  validateAccountFields,
  validatePassword,
} from "../validation";

export type AccountService = {
  listVisible(actor: AccountPublic): Promise<AccountPublic[]>;
  create(
    actor: AccountPublic,
    input: CreateAccountInput,
  ): Promise<AccountPublic>;
  update(
    actor: AccountPublic,
    id: string,
    input: UpdateAccountInput,
  ): Promise<AccountPublic>;
  resetPassword(
    actor: AccountPublic,
    id: string,
    password: string,
  ): Promise<{ reauthenticate: boolean }>;
  setStatus(
    actor: AccountPublic,
    id: string,
    status: AccountStatus,
  ): Promise<AccountPublic>;
  listAudit(
    actor: AccountPublic,
    limit?: number,
  ): Promise<AccountAuditLog[]>;
};

export class AccountServiceError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "FORBIDDEN"
      | "VALIDATION",
    message: string,
  ) {
    super(message);
    this.name = "AccountServiceError";
  }
}

const roleLabel: Record<Role, string> = {
  admin: "管理员",
  leader: "团长",
  collector: "数采人员",
};

function toPublicAccount(record: AccountRecord): AccountPublic {
  return {
    id: record.id,
    displayName: record.displayName,
    username: record.username,
    role: record.role,
    teamId: record.teamId,
    status: record.status,
    updatedAt: record.updatedAt,
  };
}

function assertActive(actor: AccountPublic): void {
  if (actor.status !== "active") {
    throw new AccountServiceError("FORBIDDEN", "账号已停用");
  }
}

function assertAdministrator(actor: AccountPublic): void {
  assertActive(actor);
  if (actor.role !== "admin") {
    throw new AccountServiceError("FORBIDDEN", "仅管理员可执行此操作");
  }
}

function validationError(error: unknown): AccountServiceError {
  return new AccountServiceError(
    "VALIDATION",
    error instanceof Error ? error.message : "账号信息不正确",
  );
}

function auditLog(
  actor: AccountPublic,
  target: AccountRecord,
  action: AccountAuditLog["action"],
  summary: string,
  createdAt: number,
): AccountAuditLog {
  return {
    id: `AUD-${crypto.randomUUID()}`,
    actorAccountId: actor.id,
    actorName: actor.displayName,
    action,
    targetAccountId: target.id,
    targetName: target.displayName,
    summary,
    createdAt,
  };
}

function isUniqueConstraintFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    /unique|idx_accounts_username_normalized/iu.test(error.message)
  );
}

async function protectLastActiveAdministrator(
  repo: AccountRepository,
  target: AccountRecord,
): Promise<void> {
  if (
    target.role === "admin" &&
    target.status === "active" &&
    (await repo.countActiveAdmins()) <= 1
  ) {
    throw new AccountServiceError(
      "VALIDATION",
      "系统必须保留至少一个启用的管理员",
    );
  }
}

export function createAccountService(
  repo: AccountRepository,
  options: {
    now?: () => number;
    createId?: () => string;
  } = {},
): AccountService {
  const now = options.now ?? Date.now;
  const createId =
    options.createId ?? (() => `U-${crypto.randomUUID()}`);

  return {
    async listVisible(actor) {
      assertActive(actor);
      if (actor.role === "admin") {
        return repo.listAccounts({ kind: "all" });
      }
      if (actor.role === "leader") {
        if (!actor.teamId) {
          throw new AccountServiceError(
            "FORBIDDEN",
            "当前团长未加入团队",
          );
        }
        return repo.listAccounts({
          kind: "team",
          teamId: actor.teamId,
        });
      }
      return repo.listAccounts({
        kind: "self",
        accountId: actor.id,
      });
    },

    async create(actor, input) {
      assertAdministrator(actor);

      let validated: ReturnType<typeof validateAccountFields>;
      let password: string;
      try {
        validated = validateAccountFields(input);
        password = validatePassword(input.password);
      } catch (error) {
        throw validationError(error);
      }

      if (
        await repo.findByNormalizedUsername(
          validated.usernameNormalized,
        )
      ) {
        throw new AccountServiceError(
          "CONFLICT",
          "用户名已存在",
        );
      }

      const timestamp = now();
      const stored = await hashPassword(password);
      const record: AccountRecord = {
        id: createId(),
        ...validated,
        passwordHash: stored.hash,
        passwordSalt: stored.salt,
        passwordIterations: stored.iterations,
        status: "active",
        failedAttemptCount: 0,
        firstFailedAt: null,
        lockedUntil: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const audit = auditLog(
        actor,
        record,
        "create",
        `创建${roleLabel[record.role]}账号`,
        timestamp,
      );

      try {
        return await repo.createAccount(record, audit);
      } catch (error) {
        if (isUniqueConstraintFailure(error)) {
          throw new AccountServiceError(
            "CONFLICT",
            "用户名已存在",
          );
        }
        throw error;
      }
    },

    async update(actor, id, input) {
      assertAdministrator(actor);
      const target = await repo.findById(id);
      if (!target) {
        throw new AccountServiceError("NOT_FOUND", "账号不存在");
      }

      let validated: ReturnType<typeof validateAccountFields>;
      try {
        validated = validateAccountFields(input);
      } catch (error) {
        throw validationError(error);
      }

      if (
        target.role === "admin" &&
        validated.role !== "admin"
      ) {
        await protectLastActiveAdministrator(repo, target);
      }

      if (
        validated.usernameNormalized !== target.usernameNormalized &&
        (await repo.findByNormalizedUsername(
          validated.usernameNormalized,
        ))
      ) {
        throw new AccountServiceError(
          "CONFLICT",
          "用户名已存在",
        );
      }

      const timestamp = now();
      const updated: AccountRecord = {
        ...target,
        ...validated,
        updatedAt: timestamp,
      };
      const changedFields = [
        target.displayName !== updated.displayName && "显示名称",
        target.username !== updated.username && "用户名",
        target.role !== updated.role && "角色",
        target.teamId !== updated.teamId && "所属团队",
      ].filter(Boolean);
      const summary =
        changedFields.length > 0
          ? `更新账号：${changedFields.join("、")}`
          : "确认账号信息";

      try {
        return await repo.updateAccount(
          updated,
          auditLog(actor, updated, "update", summary, timestamp),
        );
      } catch (error) {
        if (isUniqueConstraintFailure(error)) {
          throw new AccountServiceError(
            "CONFLICT",
            "用户名已存在",
          );
        }
        throw error;
      }
    },

    async resetPassword(actor, id, passwordInput) {
      assertAdministrator(actor);
      const target = await repo.findById(id);
      if (!target) {
        throw new AccountServiceError("NOT_FOUND", "账号不存在");
      }

      let password: string;
      try {
        password = validatePassword(passwordInput);
      } catch (error) {
        throw validationError(error);
      }

      const timestamp = now();
      const stored = await hashPassword(password);
      const updated: AccountRecord = {
        ...target,
        passwordHash: stored.hash,
        passwordSalt: stored.salt,
        passwordIterations: stored.iterations,
        failedAttemptCount: 0,
        firstFailedAt: null,
        lockedUntil: null,
        updatedAt: timestamp,
      };
      await repo.resetPassword(
        updated,
        auditLog(
          actor,
          updated,
          "reset_password",
          "管理员重置了账号密码",
          timestamp,
        ),
      );
      return { reauthenticate: id === actor.id };
    },

    async setStatus(actor, id, status) {
      assertAdministrator(actor);
      if (status !== "active" && status !== "disabled") {
        throw new AccountServiceError(
          "VALIDATION",
          "账号状态不正确",
        );
      }
      const target = await repo.findById(id);
      if (!target) {
        throw new AccountServiceError("NOT_FOUND", "账号不存在");
      }
      if (target.status === status) {
        return toPublicAccount(target);
      }
      if (status === "disabled") {
        if (id === actor.id) {
          throw new AccountServiceError(
            "VALIDATION",
            "不能停用当前登录账号",
          );
        }
        await protectLastActiveAdministrator(repo, target);
      }

      const timestamp = now();
      const updated = {
        ...target,
        status,
        updatedAt: timestamp,
      };
      const action =
        status === "active" ? "enable" : "disable";
      return repo.setStatus(
        updated,
        auditLog(
          actor,
          updated,
          action,
          status === "active" ? "启用账号" : "停用账号",
          timestamp,
        ),
      );
    },

    async listAudit(actor, limit = 100) {
      assertAdministrator(actor);
      const safeLimit = Math.max(
        1,
        Math.min(100, Math.trunc(limit)),
      );
      return repo.listAuditLogs(safeLimit);
    },
  };
}
