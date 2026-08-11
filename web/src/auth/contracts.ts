import type { AccountStatus, Role } from "../domain/types";

export type AccountPublic = {
  id: string;
  displayName: string;
  username: string;
  role: Role;
  teamId?: string;
  status: AccountStatus;
  updatedAt: number;
};

export type TeamPublic = {
  id: string;
  name: string;
  status: "active" | "disabled";
  unitPricePerMinute: number;
  createdAt: number;
  updatedAt: number;
};

export type CreateTeamInput = Pick<
  TeamPublic,
  "name" | "unitPricePerMinute"
>;

export type UpdateTeamInput = CreateTeamInput &
  Pick<TeamPublic, "status">;

export type AccountRecord = AccountPublic & {
  usernameNormalized: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  failedAttemptCount: number;
  firstFailedAt: number | null;
  lockedUntil: number | null;
  createdAt: number;
};

export type AccountAuditAction =
  | "create"
  | "update"
  | "reset_password"
  | "enable"
  | "disable";

export type AccountAuditLog = {
  id: string;
  actorAccountId: string;
  actorName: string;
  action: AccountAuditAction;
  targetAccountId: string;
  targetName: string;
  summary: string;
  createdAt: number;
};

export type CreateAccountInput = {
  displayName: string;
  username: string;
  password: string;
  role: Role;
  teamId?: string;
};

export type UpdateAccountInput = Omit<CreateAccountInput, "password">;

export type AccountScope =
  | { kind: "all" }
  | { kind: "team"; teamId: string }
  | { kind: "self"; accountId: string };

export interface AccountRepository {
  isAccountTableEmpty(): Promise<boolean>;
  insertSeedAccounts(records: AccountRecord[]): Promise<void>;
  findById(id: string): Promise<AccountRecord | null>;
  findByNormalizedUsername(username: string): Promise<AccountRecord | null>;
  listAccounts(scope: AccountScope): Promise<AccountPublic[]>;
  countActiveAdmins(): Promise<number>;
  createAccount(
    record: AccountRecord,
    audit: AccountAuditLog,
  ): Promise<AccountPublic>;
  updateAccount(
    record: AccountRecord,
    audit: AccountAuditLog,
  ): Promise<AccountPublic>;
  updateLoginSecurity(
    id: string,
    values: Pick<
      AccountRecord,
      "failedAttemptCount" | "firstFailedAt" | "lockedUntil"
    >,
  ): Promise<void>;
  createSession(
    tokenHash: string,
    accountId: string,
    createdAt: number,
    expiresAt: number,
  ): Promise<void>;
  findSessionAccount(
    tokenHash: string,
    now: number,
  ): Promise<AccountRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsForAccount(accountId: string): Promise<void>;
  resetPassword(
    record: AccountRecord,
    audit: AccountAuditLog,
  ): Promise<void>;
  setStatus(
    record: AccountRecord,
    audit: AccountAuditLog,
  ): Promise<AccountPublic>;
  listAuditLogs(limit: number): Promise<AccountAuditLog[]>;
}
