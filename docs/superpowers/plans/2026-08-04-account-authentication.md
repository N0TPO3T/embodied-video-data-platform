# Account Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace demo role switching with persistent username/password authentication and administrator-managed accounts backed by Cloudflare D1.

**Architecture:** Add a server-only account domain around D1 with PBKDF2 password hashing, opaque database-backed sessions, lockout rules, and administrator authorization. The catch-all server page enforces role access and passes the minimum permitted account snapshot into the existing demo store; client pages call typed JSON endpoints for login, logout, and account management.

**Tech Stack:** React 19, TypeScript 5.9, vinext/Next route handlers, Cloudflare Workers Web Crypto, Cloudflare D1, Drizzle ORM/Kit, Miniflare, Vitest, Testing Library.

## Global Constraints

- Account, password, session, status, login-failure, and account-audit state must persist in D1 under logical binding `DB`.
- Existing video, quality, settlement, withdrawal, and delivery data remains session-only demo state.
- Passwords use PBKDF2-HMAC-SHA-256 with a 16-byte random salt and exactly 600000 iterations.
- Password length is 8 through 64 characters; plaintext passwords never enter logs, API responses, migrations, or stored records.
- The session cookie is `evdp_session`, lasts 7 days, and uses `HttpOnly`, `SameSite=Lax`, `Path=/`, plus `Secure` outside localhost.
- Five failed logins within 15 minutes lock the account for 15 minutes.
- Username comparison is case-insensitive after trimming and lowercasing; accepted usernames are 3 through 32 ASCII letters, digits, dots, underscores, or hyphens.
- Only administrators can create, edit, reset, enable, or disable accounts.
- Administrators may create all three roles; the system must retain at least one active administrator and cannot disable the current account.
- Administrator accounts have no team; leader and collector accounts require `TEAM-01` or `TEAM-02`.
- No self-registration, forced first-login password change, forgot-password flow, SMS, account deletion, external OAuth, or session-management UI is added.
- All dashboard route access and account API authorization is enforced server-side.
- User-facing copy remains Simplified Chinese.
- Every production behavior starts with a watched failing automated test.
- Run package commands from `web/`.

---

## File Structure

- `web/src/auth/contracts.ts`: safe account/session contracts, inputs, error codes, and repository interface.
- `web/src/auth/validation.ts`: username, display-name, password, role, and team validation.
- `web/src/auth/password.ts`: PBKDF2 hashing, verification, token generation, and token hashing.
- `web/src/auth/server/d1AccountRepository.ts`: all prepared D1 queries and batched account mutations.
- `web/src/auth/server/bootstrapAccounts.ts`: idempotent initial account creation.
- `web/src/auth/server/authService.ts`: login, lockout, session authentication, and logout.
- `web/src/auth/server/accountService.ts`: administrator account lifecycle and audit rules.
- `web/src/auth/server/http.ts`: JSON parsing, same-origin checks, cookie serialization, and handler factories.
- `web/src/auth/server/access.ts`: role-home mapping and server route-access decisions.
- `web/src/auth/server/runtime.ts`: construct D1 repository and services from the Worker binding.
- `web/src/auth/client/accountApi.ts`: typed browser requests for login/logout and administrator mutations.
- `web/db/schema.ts`: Drizzle account, session, and account-audit tables/indexes.
- `web/drizzle/0000_account-authentication.sql`: generated account-domain migration.
- `web/app/api/**/route.ts`: thin vinext route-handler exports.
- `web/app/[[...slug]]/page.tsx`: read the session, enforce server access, and provide a scoped account snapshot.
- `web/src/data/DemoStoreContext.tsx`: initialize the demo store from authenticated account data and synchronize account mutations.
- `web/src/features/auth/LoginPage.tsx`: username/password login form.
- `web/src/layout/DashboardShell.tsx`: current-account display and logout.
- `web/src/features/admin/UsersTeamsPage.tsx`: persistent account list, filters, and actions.
- `web/src/features/admin/UserFormModal.tsx`: create/edit account form.
- `web/src/features/admin/ResetPasswordModal.tsx`: password reset form.
- `web/src/features/admin/AccountStatusModal.tsx`: enable/disable confirmation.
- `web/src/features/admin/AuditLogPage.tsx`: combine persistent account audit with demo operation logs.

---

### Task 1: Account Contracts, Validation, and D1 Schema

**Files:**
- Create: `web/src/auth/contracts.ts`
- Create: `web/src/auth/validation.ts`
- Create: `web/src/auth/validation.test.ts`
- Modify: `web/src/domain/types.ts`
- Modify: `web/src/data/demoData.ts`
- Modify: `web/db/schema.ts`
- Modify: `web/.openai/hosting.json`
- Modify: `web/package.json`
- Modify: `web/pnpm-lock.yaml`
- Create: `web/drizzle/0000_account-authentication.sql`

**Interfaces:**
- Produces: `AccountPublic`, `AccountRecord`, `AccountAuditLog`, `CreateAccountInput`, `UpdateAccountInput`, `AccountRepository`, `normalizeUsername()`, `validateAccountFields()`, and `validatePassword()`.
- Consumes: existing `Role`, `User`, and team IDs `TEAM-01` / `TEAM-02`.

- [ ] **Step 1: Write failing validation tests**

Create `src/auth/validation.test.ts` with real inputs:

```ts
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
```

- [ ] **Step 2: Run the validation test and verify RED**

Run: `pnpm test -- src/auth/validation.test.ts`

Expected: FAIL because `contracts.ts` and `validation.ts` do not exist.

- [ ] **Step 3: Add exact account contracts**

Create `contracts.ts` with these public contracts and no password fields on `AccountPublic`:

```ts
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

export type AccountAuditLog = {
  id: string;
  actorAccountId: string;
  actorName: string;
  action: "create" | "update" | "reset_password" | "enable" | "disable";
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
  createAccount(record: AccountRecord, audit: AccountAuditLog): Promise<AccountPublic>;
  updateAccount(record: AccountRecord, audit: AccountAuditLog): Promise<AccountPublic>;
  updateLoginSecurity(id: string, values: Pick<AccountRecord, "failedAttemptCount" | "firstFailedAt" | "lockedUntil">): Promise<void>;
  createSession(tokenHash: string, accountId: string, createdAt: number, expiresAt: number): Promise<void>;
  findSessionAccount(tokenHash: string, now: number): Promise<AccountRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsForAccount(accountId: string): Promise<void>;
  resetPassword(record: AccountRecord, audit: AccountAuditLog): Promise<void>;
  setStatus(record: AccountRecord, audit: AccountAuditLog): Promise<AccountPublic>;
  listAuditLogs(limit: number): Promise<AccountAuditLog[]>;
}
```

Define `AccountStatus = "active" | "disabled"` beside `Role` in `domain/types.ts`, then extend `User` with `status: AccountStatus` and `updatedAt: number`. Add `status: "active"` and `updatedAt: 1_722_708_000_000` to all eight existing `demoSeed.users` records so this task remains type-correct before the generic display-name rewrite in Task 8. Keeping both primitives in the domain module avoids a circular type dependency between the demo model and authentication contracts.

- [ ] **Step 4: Implement exact validation rules**

Create `validation.ts` with:

```ts
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const TEAM_IDS = new Set(["TEAM-01", "TEAM-02"]);

export function normalizeUsername(value: string): string {
  const username = value.trim();
  if (!USERNAME.test(username)) {
    throw new Error("用户名需为 3 到 32 位字母、数字、点、下划线或连字符");
  }
  return username.toLowerCase();
}

export function validatePassword(password: string): string {
  if (password.length < 8 || password.length > 64) {
    throw new Error("密码长度需为 8 到 64 位");
  }
  return password;
}

export function validateAccountFields(input: {
  displayName: string;
  username: string;
  role: Role;
  teamId?: string;
}) {
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 30) {
    throw new Error("显示名称需为 1 到 30 个字符");
  }
  const username = input.username.trim();
  const usernameNormalized = normalizeUsername(username);
  if (input.role === "admin") {
    return { displayName, username, usernameNormalized, role: input.role, teamId: undefined };
  }
  if (!input.teamId || !TEAM_IDS.has(input.teamId)) {
    throw new Error("请选择有效团队");
  }
  return { displayName, username, usernameNormalized, role: input.role, teamId: input.teamId };
}
```

- [ ] **Step 5: Define the D1 schema and direct Miniflare dependency**

Add `miniflare: "4.20260515.0"` to `devDependencies`. Define `accounts`, `authSessions`, and `accountAuditLogs` in `db/schema.ts` using `sqliteTable`, `text`, `integer`, `uniqueIndex`, and `index`. Use these exact index names:

```ts
"idx_accounts_username_normalized"
"idx_accounts_team_id"
"idx_accounts_role_status"
"idx_auth_sessions_account_id"
"idx_account_audit_created_at"
```

Set `"d1": "DB"` in `.openai/hosting.json`, keep `"r2": null`, then run:

```bash
pnpm install --offline
pnpm exec drizzle-kit generate --name=account-authentication
```

Rename only if necessary so the committed migration path is exactly `drizzle/0000_account-authentication.sql`. Inspect it and confirm it creates all three tables and five indexes without plaintext seed passwords.

- [ ] **Step 6: Run validation, migration, and type checks**

Run:

```bash
pnpm test -- src/auth/validation.test.ts
pnpm typecheck
rg -n "admin123|tuanzhang1|ceshirenyuan1" drizzle
```

Expected: validation tests pass, type checking passes, and the migration search returns no matches.

- [ ] **Step 7: Commit the account foundation**

```bash
git add web/package.json web/pnpm-lock.yaml web/.openai/hosting.json web/db web/drizzle web/src/auth/contracts.ts web/src/auth/validation.ts web/src/auth/validation.test.ts web/src/domain/types.ts web/src/data/demoData.ts
git commit -m "feat: add persistent account schema"
```

---

### Task 2: Password and Session Cryptography

**Files:**
- Create: `web/src/auth/password.ts`
- Create: `web/src/auth/password.test.ts`

**Interfaces:**
- Consumes: Web Crypto available in Node 22 and Cloudflare Workers.
- Produces: `hashPassword()`, `verifyPassword()`, `generateSessionToken()`, `hashSessionToken()`, `constantTimeEqual()`, and constants `PASSWORD_ITERATIONS`, `SESSION_TTL_MS`.

- [ ] **Step 1: Write failing cryptography tests**

```ts
import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./password";

describe("password and session cryptography", () => {
  it("hashes and verifies a password without storing plaintext", async () => {
    const stored = await hashPassword("admin123", new Uint8Array(16).fill(7));
    expect(stored.hash).not.toContain("admin123");
    expect(stored.iterations).toBe(600000);
    await expect(verifyPassword("admin123", stored)).resolves.toBe(true);
    await expect(verifyPassword("wrong-pass", stored)).resolves.toBe(false);
  });

  it("creates opaque tokens and stable token digests", async () => {
    const token = generateSessionToken(new Uint8Array(32).fill(9));
    expect(token).not.toContain("=");
    await expect(hashSessionToken(token)).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test -- src/auth/password.test.ts`

Expected: FAIL because `password.ts` does not exist.

- [ ] **Step 3: Implement PBKDF2 and opaque session tokens**

Use these exact constants and signatures:

```ts
export const PASSWORD_ITERATIONS = 600_000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredPassword = {
  hash: string;
  salt: string;
  iterations: number;
};

export async function hashPassword(
  password: string,
  saltBytes = crypto.getRandomValues(new Uint8Array(16)),
): Promise<StoredPassword>;

export async function verifyPassword(
  password: string,
  stored: StoredPassword,
): Promise<boolean>;

export function generateSessionToken(
  bytes = crypto.getRandomValues(new Uint8Array(32)),
): string;

export async function hashSessionToken(token: string): Promise<string>;
```

Encode bytes with Base64URL, import PBKDF2 key material through `crypto.subtle.importKey`, derive 256 bits with SHA-256, and compare decoded byte arrays with an XOR accumulator so the loop always visits every byte.

- [ ] **Step 4: Run cryptography tests and type checking**

Run:

```bash
pnpm test -- src/auth/password.test.ts
pnpm typecheck
```

Expected: all selected tests pass and no type errors are reported.

- [ ] **Step 5: Commit cryptographic primitives**

```bash
git add web/src/auth/password.ts web/src/auth/password.test.ts
git commit -m "feat: add password and session cryptography"
```

---

### Task 3: D1 Repository and Idempotent Account Bootstrap

**Files:**
- Create: `web/src/auth/server/d1AccountRepository.ts`
- Create: `web/src/auth/server/bootstrapAccounts.ts`
- Create: `web/src/auth/server/d1AccountRepository.test.ts`
- Create: `web/src/auth/server/testD1.ts`
- Create: `web/src/auth/server/testFactories.ts`

**Interfaces:**
- Consumes: `AccountRepository`, `AccountRecord`, `AccountAuditLog`, the generated migration, `hashPassword()`.
- Produces: `createD1AccountRepository(db: D1Database): AccountRepository`, `ensureInitialAccounts(repo, now): Promise<void>`, and `initialAccountDefinitions`.

- [ ] **Step 1: Write a failing real-D1 repository test**

Use a Node test environment and Miniflare D1 rather than mocking SQL:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1AccountRepository } from "./d1AccountRepository";
import { createTestD1 } from "./testD1";

describe("D1 account repository", () => {
  let dispose: () => Promise<void>;
  let db: D1Database;

  beforeEach(async () => ({ db, dispose } = await createTestD1()));
  afterEach(async () => dispose());

  it("persists an account and retrieves it case-insensitively", async () => {
    const repo = createD1AccountRepository(db);
    const record = makeAccountRecord({
      id: "U-TEST-1",
      displayName: "测试管理员",
      username: "Admin.Two",
      usernameNormalized: "admin.two",
      role: "admin",
    });
    await repo.createAccount(record, makeAudit(record));
    await expect(repo.findByNormalizedUsername("admin.two"))
      .resolves.toMatchObject({ id: "U-TEST-1", username: "Admin.Two" });
  });

  it("atomically resets a password, clears sessions, and writes audit", async () => {
    const repo = createD1AccountRepository(db);
    const record = makeAccountRecord({ id: "U-TEST-2", username: "reset.user" });
    await repo.createAccount(record, makeAudit(record));
    await repo.createSession("digest", record.id, 10, 1000);
    await repo.resetPassword({ ...record, passwordHash: "next" }, makeResetAudit(record));
    await expect(repo.findSessionAccount("digest", 20)).resolves.toBeNull();
    await expect(repo.listAuditLogs(10)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "reset_password" })]),
    );
  });
});
```

`testD1.ts` must start `Miniflare` with `d1Databases: { DB: "account-test" }`, read `drizzle/0000_account-authentication.sql`, split it only on Drizzle's `--> statement-breakpoint`, and apply exactly one prepared SQL statement at a time.

Define the referenced reusable test builders in `testFactories.ts` and import them from repository and service tests:

```ts
export function makeAccountPublic(overrides: Partial<AccountPublic> = {}): AccountPublic {
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

export function makeAccountRecord(overrides: Partial<AccountRecord> = {}): AccountRecord {
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
  return { ...makeAudit(target), id: `AUD-RESET-${target.id}`, action: "reset_password" };
}
```

- [ ] **Step 2: Run the repository test and verify RED**

Run: `pnpm test -- src/auth/server/d1AccountRepository.test.ts`

Expected: FAIL because the D1 repository and helper do not exist.

- [ ] **Step 3: Implement prepared D1 queries**

Implement every `AccountRepository` method with positional parameters and `db.prepare(...).bind(...)`. Map snake-case rows through one `toAccountRecord()` function. Use `db.batch([...])` for:

- account create + audit insert;
- account update + audit insert;
- password update + all-session deletion + audit insert;
- status update + optional all-session deletion + audit insert.

`listAccounts(scope)` must execute one of three explicit queries:

```sql
SELECT id, display_name, username, role, team_id, status, updated_at FROM accounts ORDER BY created_at ASC
SELECT id, display_name, username, role, team_id, status, updated_at FROM accounts WHERE team_id = ? ORDER BY created_at ASC
SELECT id, display_name, username, role, team_id, status, updated_at FROM accounts WHERE id = ? ORDER BY created_at ASC
```

`findSessionAccount()` must join `auth_sessions` to `accounts`, require `expires_at > ?`, and require account status `active`.

- [ ] **Step 4: Add and test the eight initial accounts**

Define these exact server-only seed rows in `bootstrapAccounts.ts`:

```ts
const initialAccountDefinitions = [
  ["U-ADMIN-01", "管理员", "admin", "admin123", "admin", undefined],
  ["U-LEAD-01", "团长1", "tuanzhang1", "tuanzhang1", "leader", "TEAM-01"],
  ["U-LEAD-02", "团长2", "tuanzhang2", "tuanzhang2", "leader", "TEAM-02"],
  ["U-COL-01", "测试人员1", "ceshirenyuan1", "ceshirenyuan1", "collector", "TEAM-01"],
  ["U-COL-02", "测试人员2", "ceshirenyuan2", "ceshirenyuan2", "collector", "TEAM-02"],
  ["U-COL-03", "测试人员3", "ceshirenyuan3", "ceshirenyuan3", "collector", "TEAM-01"],
  ["U-COL-04", "测试人员4", "ceshirenyuan4", "ceshirenyuan4", "collector", "TEAM-01"],
  ["U-COL-05", "测试人员5", "ceshirenyuan5", "ceshirenyuan5", "collector", "TEAM-01"],
] as const;
```

Add tests that call `ensureInitialAccounts(repo, 1_722_700_000_000)` twice and assert exactly eight accounts, one active administrator, two leaders, and five collectors. Assert stored password hashes do not equal any initial plaintext password.

- [ ] **Step 5: Run D1, cryptography, validation, and type checks**

Run:

```bash
pnpm test -- src/auth/server/d1AccountRepository.test.ts src/auth/password.test.ts src/auth/validation.test.ts
pnpm typecheck
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit D1 persistence**

```bash
git add web/src/auth/server/d1AccountRepository.ts web/src/auth/server/bootstrapAccounts.ts web/src/auth/server/d1AccountRepository.test.ts web/src/auth/server/testD1.ts web/src/auth/server/testFactories.ts
git commit -m "feat: persist accounts and sessions in D1"
```

---

### Task 4: Authentication, Administrator Services, and Route Handlers

**Files:**
- Create: `web/src/auth/server/authService.ts`
- Create: `web/src/auth/server/accountService.ts`
- Create: `web/src/auth/server/http.ts`
- Create: `web/src/auth/server/runtime.ts`
- Create: `web/src/auth/server/authService.test.ts`
- Create: `web/src/auth/server/accountService.test.ts`
- Create: `web/src/auth/server/http.test.ts`
- Create: `web/app/api/auth/login/route.ts`
- Create: `web/app/api/auth/logout/route.ts`
- Create: `web/app/api/auth/session/route.ts`
- Create: `web/app/api/admin/accounts/route.ts`
- Create: `web/app/api/admin/accounts/[id]/route.ts`
- Create: `web/app/api/admin/accounts/[id]/reset-password/route.ts`
- Create: `web/app/api/admin/accounts/[id]/status/route.ts`
- Create: `web/app/api/admin/account-audit/route.ts`

**Interfaces:**
- Consumes: `AccountRepository`, password/token helpers, account validators, D1 binding `DB`.
- Produces: `AuthService`, `AccountService`, handler factories, `getRuntimeServices()`, and all JSON endpoints.

- [ ] **Step 1: Write failing authentication-service tests**

Cover success, invalid credentials, disabled accounts, five-attempt lockout, successful reset of the failure window, session authentication, and logout:

```ts
it("locks an account after five failures in fifteen minutes", async () => {
  const { service, repo, advance } = await authenticatedFixture();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await expect(service.login("admin", "wrong-pass")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  }
  await expect(service.login("admin", "wrong-pass")).rejects.toMatchObject({
    code: "LOCKED",
  });
  await expect(service.login("admin", "admin123")).rejects.toMatchObject({
    code: "LOCKED",
  });
  advance(15 * 60 * 1000 + 1);
  await expect(service.login("admin", "admin123")).resolves.toMatchObject({
    user: { role: "admin" },
  });
  expect((await repo.findById("U-ADMIN-01"))?.failedAttemptCount).toBe(0);
});
```

Define `authenticatedFixture()` in `authService.test.ts` using the real Miniflare D1 helper:

```ts
async function authenticatedFixture() {
  const { db, dispose } = await createTestD1();
  const repo = createD1AccountRepository(db);
  const stored = await hashPassword("admin123", new Uint8Array(16).fill(3));
  const admin = makeAccountRecord({
    id: "U-ADMIN-01",
    displayName: "管理员",
    username: "admin",
    usernameNormalized: "admin",
    role: "admin",
    teamId: undefined,
    passwordHash: stored.hash,
    passwordSalt: stored.salt,
    passwordIterations: stored.iterations,
  });
  await repo.createAccount(admin, makeAudit(admin));
  let currentTime = 1_722_708_000_000;
  const service = createAuthService(repo, {
    now: () => currentTime,
    randomSessionBytes: () => new Uint8Array(32).fill(8),
  });
  return {
    service,
    repo,
    dispose,
    advance: (milliseconds: number) => { currentTime += milliseconds; },
  };
}
```

Each test must call `dispose()` in `finally` or through an `afterEach`-registered disposer.

- [ ] **Step 2: Run authentication tests and verify RED**

Run: `pnpm test -- src/auth/server/authService.test.ts`

Expected: FAIL because `AuthService` does not exist.

- [ ] **Step 3: Implement `AuthService`**

Export:

```ts
export class AuthError extends Error {
  constructor(
    readonly code: "INVALID_CREDENTIALS" | "DISABLED" | "LOCKED" | "UNAUTHENTICATED" | "FORBIDDEN",
    message: string,
    readonly retryAfterSeconds?: number,
  ) { super(message); }
}

export type AuthService = {
  login(username: string, password: string): Promise<{
    user: AccountPublic;
    token: string;
    expiresAt: number;
  }>;
  authenticate(token: string | null): Promise<AccountPublic | null>;
  logout(token: string | null): Promise<void>;
};

export function createAuthService(
  repo: AccountRepository,
  options?: { now?: () => number; randomSessionBytes?: () => Uint8Array },
): AuthService;
```

Use a fixed dummy `StoredPassword` for nonexistent usernames so invalid username and invalid password both perform PBKDF2 and return `INVALID_CREDENTIALS`.

- [ ] **Step 4: Write failing administrator-service tests**

Test all three roles, case-insensitive duplicate usernames, edit, reset, enable/disable, self-disable, and last-active-admin protection:

```ts
it("allows an administrator to create another administrator", async () => {
  const { service, admin } = await accountServiceFixture();
  await expect(service.create(admin, {
    displayName: "管理员2",
    username: "admin2",
    password: "admin234",
    role: "admin",
  })).resolves.toMatchObject({ role: "admin", teamId: undefined });
});

it("protects the current and last active administrator", async () => {
  const { service, admin } = await accountServiceFixture();
  await expect(service.setStatus(admin, admin.id, "disabled"))
    .rejects.toThrow("不能停用当前登录账号");
  await expect(service.update(admin, admin.id, {
    displayName: admin.displayName,
    username: admin.username,
    role: "collector",
    teamId: "TEAM-01",
  })).rejects.toThrow("系统必须保留至少一个启用的管理员");
});
```

- [ ] **Step 5: Implement `AccountService`**

Export methods with exact signatures:

```ts
export type AccountService = {
  listVisible(actor: AccountPublic): Promise<AccountPublic[]>;
  create(actor: AccountPublic, input: CreateAccountInput): Promise<AccountPublic>;
  update(actor: AccountPublic, id: string, input: UpdateAccountInput): Promise<AccountPublic>;
  resetPassword(actor: AccountPublic, id: string, password: string): Promise<{ reauthenticate: boolean }>;
  setStatus(actor: AccountPublic, id: string, status: AccountStatus): Promise<AccountPublic>;
  listAudit(actor: AccountPublic, limit?: number): Promise<AccountAuditLog[]>;
};

export class AccountServiceError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "VALIDATION",
    message: string,
  ) { super(message); }
}

export function createAccountService(
  repo: AccountRepository,
  options?: { now?: () => number; createId?: () => string },
): AccountService;
```

`listVisible()` requires an active account and maps role to `AccountScope`: admin `all`, leader `team`, collector `self`. Every mutation and `listAudit()` additionally requires `actor.role === "admin"`. Perform a normalized-username precheck and convert a concurrent D1 unique-index failure into `AccountServiceError("CONFLICT", "用户名已存在")`. Build audit summaries from changed safe fields only; reset-password summary is exactly `管理员重置了账号密码`. `resetPassword()` returns `{ reauthenticate: id === actor.id }` after deleting all target sessions.

Define `accountServiceFixture()` in `accountService.test.ts` by creating a fresh `createTestD1()`, inserting the same administrator record shown in `authenticatedFixture()`, and calling:

```ts
const service = createAccountService(repo, {
  now: () => 1_722_708_000_000,
  createId: () => "U-NEW-ADMIN-02",
});
return { service, repo, admin, dispose };
```

Use `try/finally` in every test to call `dispose()`.

- [ ] **Step 6: Write failing handler tests**

Use handler factories with injected services. Test same-origin rejection, status codes, cookie attributes, and that API responses contain none of `password`, `passwordHash`, `passwordSalt`, or the raw session token:

```ts
const auth = {
  login: vi.fn().mockResolvedValue({
    user: makeAccountPublic({ role: "admin", teamId: undefined }),
    token: "raw-token",
    expiresAt: 1_722_708_000_000 + SESSION_TTL_MS,
  }),
  authenticate: vi.fn(),
  logout: vi.fn(),
} satisfies AuthService;
const loginHandler = createLoginHandler(async () => auth);

const response = await loginHandler(
  new Request("https://app.test/api/auth/login", {
    method: "POST",
    headers: { origin: "https://app.test", "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  }),
);
expect(response.status).toBe(200);
expect(response.headers.get("set-cookie")).toContain("evdp_session=");
expect(response.headers.get("set-cookie")).toContain("HttpOnly");
expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
expect(await response.text()).not.toMatch(/password|sessionToken/i);
```

- [ ] **Step 7: Implement HTTP helpers and thin route exports**

`runtime.ts` imports `env` from `cloudflare:workers`, constructs the D1 repository, calls `ensureInitialAccounts()`, and returns `{ auth, accounts }`. Cache only the in-request promise; do not cache authenticated users across requests.

`http.ts` exports handler factories:

```ts
createLoginHandler(getAuthService)
createLogoutHandler(getAuthService)
createSessionHandler(getAuthService)
createAccountsCollectionHandlers(getServices)
createAccountUpdateHandler(getServices)
createPasswordResetHandler(getServices)
createAccountStatusHandler(getServices)
createAccountAuditHandler(getServices)
```

Each `route.ts` contains only the relevant factory invocation and named `GET`, `POST`, or `PATCH` export. Parse malformed JSON and `AccountServiceError("VALIDATION")` as 400, unauthenticated as 401, `FORBIDDEN` as 403, `NOT_FOUND` as 404, `CONFLICT` as 409, and unexpected errors as 500 with `操作失败，请稍后重试`.

- [ ] **Step 8: Run service, handler, repository, and type tests**

Run:

```bash
pnpm test -- src/auth/server/authService.test.ts src/auth/server/accountService.test.ts src/auth/server/http.test.ts src/auth/server/d1AccountRepository.test.ts
pnpm typecheck
```

Expected: all selected tests pass.

- [ ] **Step 9: Commit services and APIs**

```bash
git add web/src/auth/server web/app/api
git commit -m "feat: add authenticated account APIs"
```

---

### Task 5: Server Route Protection and Authenticated Demo State

**Files:**
- Create: `web/src/auth/server/access.ts`
- Create: `web/src/auth/server/access.test.ts`
- Modify: `web/app/[[...slug]]/page.tsx`
- Modify: `web/src/data/demoStore.ts`
- Modify: `web/src/data/DemoStoreContext.tsx`
- Modify: `web/src/data/demoStore.test.ts`
- Modify: `web/src/data/DemoStoreContext.test.tsx`
- Modify: `web/src/app/PlatformApp.tsx`
- Modify: `web/src/app/PlatformApp.test.tsx`
- Modify: `web/src/features/review/reviewFlow.test.tsx`
- Modify: `web/src/features/team/teamInteractions.test.tsx`
- Modify: `web/src/features/admin/adminConfiguration.test.tsx`
- Modify: `web/src/features/admin/settlementDelivery.test.tsx`
- Modify: `web/src/features/interactions/lightweightFeedback.test.tsx`

**Interfaces:**
- Consumes: authenticated `AccountPublic`, `AccountService.listVisible()`, existing `roleHome` and demo seed.
- Produces: `resolveRouteAccess()`, protected server rendering, `DemoStoreProvider({ currentAccount, accounts })`, and `syncAccount()`.

- [ ] **Step 1: Write failing access-decision tests**

```ts
import { describe, expect, it } from "vitest";
import { resolveRouteAccess } from "./access";
import { makeAccountPublic } from "./testFactories";

const adminAccount = makeAccountPublic({ role: "admin", teamId: undefined });
const collectorAccount = makeAccountPublic({
  id: "U-COL-01",
  role: "collector",
  teamId: "TEAM-01",
});

it("redirects anonymous and cross-role dashboard access", () => {
  expect(resolveRouteAccess("/admin", null)).toEqual({
    kind: "redirect",
    location: "/login?return_to=%2Fadmin",
  });
  expect(resolveRouteAccess("/admin", collectorAccount)).toEqual({
    kind: "redirect",
    location: "/collector",
  });
});

it("redirects authenticated users away from login", () => {
  expect(resolveRouteAccess("/login", adminAccount)).toEqual({
    kind: "redirect",
    location: "/admin",
  });
});
```

- [ ] **Step 2: Run access tests and verify RED**

Run: `pnpm test -- src/auth/server/access.test.ts`

Expected: FAIL because `access.ts` does not exist.

- [ ] **Step 3: Implement server access resolution**

`resolveRouteAccess(path, account)` returns `{ kind: "allow" }` or `{ kind: "redirect", location }`. Public `/` always allows; `/login` redirects authenticated accounts; `/admin`, `/team`, and `/collector` require their exact roles; unknown public paths preserve the current catch-all behavior.

In `app/[[...slug]]/page.tsx`:

1. Read `evdp_session` through `cookies()`.
2. When the cookie is absent, resolve public/login/dashboard access without constructing D1 services; this keeps public SSR and anonymous redirects independent of the database binding.
3. When the cookie exists, authenticate through runtime services.
4. Call `resolveRouteAccess()` and `redirect()` when required.
5. Load the scoped account list through `AccountService.listVisible(currentAccount)` for authenticated pages.
6. Pass `currentAccount` and mapped users to `DemoStoreProvider`.
7. Set `export const dynamic = "force-dynamic"` because the page depends on per-request cookies.

- [ ] **Step 4: Add authenticated account initialization and synchronization**

Change `DemoStoreProvider` to:

```ts
export function DemoStoreProvider({
  children,
  currentAccount,
  accounts,
}: {
  children: ReactNode;
  currentAccount?: AccountPublic;
  accounts?: AccountPublic[];
})
```

Map `AccountPublic` to safe `User` fields. For an authenticated provider, replace `demoSeed.users` with the server-scoped `accounts` snapshot rather than merging it with all seeded users, and set `currentUserId` from `currentAccount.id`. Rebuild `teams[].leaderId` and `teams[].memberIds` from role/team assignments after initial hydration and after every `syncAccount()` upsert. Add `DemoStore.syncAccount(user: User): void` and expose it through context. Remove `loginAs` from `DemoStoreValue` and all production UI; retain `DemoStore.loginAs()` only as a direct test helper until affected store tests are converted.

Use this exact safe mapping rule:

```ts
function accountToUser(account: AccountPublic, existing?: User): User {
  return {
    id: account.id,
    name: account.displayName,
    account: account.username,
    role: account.role,
    teamId: account.teamId,
    avatar: existing?.avatar ?? account.displayName.slice(0, 1),
    phone: existing?.phone ?? "未设置",
    alipayAccount: existing?.alipayAccount,
    status: account.status,
    updatedAt: account.updatedAt,
  };
}
```

For each team, keep its seeded `leaderId` when that account is present and still a leader; otherwise choose the first leader in the scoped account snapshot. Put every other scoped account with the same `teamId` into `memberIds`, including additional leader-role accounts. This keeps the current one-primary-leader demo shape while allowing administrators to create more leader accounts.

Update test render helpers to pass explicit `currentAccount` and `accounts` rather than calling `loginAs` in effects. Add a context test that synchronizes a newly created D1-style account and observes it in `state.users` and the correct team.

- [ ] **Step 5: Remove client-only role switching from `PlatformApp`**

Delete the `enter(role)` callback and change the login route to render the new login form without a role callback. Continue using `currentUser.role` only for selecting the already-authorized page and navigation. Keep the client-side `safePath` fallback as defense in depth, not the primary permission check.

- [ ] **Step 6: Run routing, store, and role regressions**

Run:

```bash
pnpm test -- src/auth/server/access.test.ts src/data/demoStore.test.ts src/data/DemoStoreContext.test.tsx src/app/PlatformApp.test.tsx src/features/review/reviewFlow.test.tsx src/features/team/teamInteractions.test.tsx src/features/admin/adminConfiguration.test.tsx src/features/admin/settlementDelivery.test.tsx src/features/interactions/lightweightFeedback.test.tsx
pnpm typecheck
```

Expected: selected tests pass without missing-hook or role-routing warnings.

- [ ] **Step 7: Commit server route protection**

```bash
git add 'web/app/[[...slug]]/page.tsx' web/src/auth/server/access.ts web/src/auth/server/access.test.ts web/src/data web/src/app web/src/features/review/reviewFlow.test.tsx web/src/features/team/teamInteractions.test.tsx web/src/features/admin/adminConfiguration.test.tsx web/src/features/admin/settlementDelivery.test.tsx web/src/features/interactions/lightweightFeedback.test.tsx
git commit -m "feat: enforce authenticated role access"
```

---

### Task 6: Username/Password Login and Logout UI

**Files:**
- Create: `web/src/auth/client/accountApi.ts`
- Create: `web/src/auth/client/accountApi.test.ts`
- Modify: `web/src/features/auth/LoginPage.tsx`
- Create: `web/src/features/auth/LoginPage.test.tsx`
- Modify: `web/src/layout/DashboardShell.tsx`
- Create: `web/src/layout/DashboardShell.test.tsx`
- Modify: `web/src/app/PlatformApp.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Consumes: `/api/auth/login`, `/api/auth/logout`, `roleHome`, and current authenticated user.
- Produces: typed `login()`, `logout()`, a real login form, and logout control.

- [ ] **Step 1: Write failing typed-client and login-form tests**

Test that `login()` parses `{ user, homePath }`, converts non-2xx JSON `{ message }` into `AccountApiError`, and never echoes the submitted password into thrown errors.

For the real `LoginPage`:

```tsx
it("submits username and password and enters the returned role home", async () => {
  const user = userEvent.setup();
  const onAuthenticated = vi.fn();
  serverLogin.mockResolvedValue({ user: adminAccount, homePath: "/admin" });
  render(<LoginPage navigate={vi.fn()} onAuthenticated={onAuthenticated} />);
  await user.type(screen.getByLabelText("用户名"), "admin");
  await user.type(screen.getByLabelText("密码"), "admin123");
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(serverLogin).toHaveBeenCalledWith("admin", "admin123");
  expect(onAuthenticated).toHaveBeenCalledWith("/admin");
});

it("can reveal and hide the password", async () => {
  const user = userEvent.setup();
  render(<LoginPage navigate={vi.fn()} onAuthenticated={vi.fn()} />);
  expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
  await user.click(screen.getByRole("button", { name: "显示密码" }));
  expect(screen.getByLabelText("密码")).toHaveAttribute("type", "text");
});
```

Set up that test with an explicit module mock:

```ts
vi.mock("../../auth/client/accountApi", () => ({ login: vi.fn() }));
import { login as serverLoginImport } from "../../auth/client/accountApi";
const serverLogin = vi.mocked(serverLoginImport);
const adminAccount: AccountPublic = {
  id: "U-ADMIN-01",
  displayName: "管理员",
  username: "admin",
  role: "admin",
  status: "active",
  updatedAt: 1_722_708_000_000,
};
```

- [ ] **Step 2: Run login tests and verify RED**

Run: `pnpm test -- src/auth/client/accountApi.test.ts src/features/auth/LoginPage.test.tsx`

Expected: FAIL because the client API and new form props do not exist.

- [ ] **Step 3: Implement the login client and page**

`accountApi.ts` exports:

```ts
export class AccountApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function login(username: string, password: string): Promise<{ user: AccountPublic; homePath: string }>;
export async function logout(): Promise<void>;
```

Replace the role cards with controlled username/password fields, a reveal button with accessible labels, inline `role="alert"`, and a submit button that shows `登录中…` while disabled. Do not render initial credentials on the page. `PlatformApp` supplies `onAuthenticated={(homePath) => window.location.assign(homePath)}` so the server validates the new page request.

- [ ] **Step 4: Write a failing logout-shell test**

Render `DashboardShell` with `onLogout` injected, click `退出登录`, and assert the handler fires once. Assert the page contains no `演示角色` select.

- [ ] **Step 5: Implement logout and responsive styles**

Change `DashboardShell` to accept `onLogout(): Promise<void> | void`. Remove the `loginAs` select and Chevron icon. Add a `退出登录` button that disables during logout. `PlatformApp` supplies a handler that calls `accountApi.logout()` and then `window.location.assign("/login")`.

Add login-field, password-toggle, logout-button, focus-visible, error, and mobile rules to `app/globals.css`. Retain at least 40px touch targets.

- [ ] **Step 6: Run login, shell, routing, accessibility, and type tests**

Run:

```bash
pnpm test -- src/auth/client/accountApi.test.ts src/features/auth/LoginPage.test.tsx src/layout/DashboardShell.test.tsx src/app/PlatformApp.test.tsx src/components/Modal.test.tsx
pnpm typecheck
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit login and logout UI**

```bash
git add web/src/auth/client web/src/features/auth web/src/layout/DashboardShell.tsx web/src/layout/DashboardShell.test.tsx web/src/app/PlatformApp.tsx web/app/globals.css
git commit -m "feat: add username and password login"
```

---

### Task 7: Persistent Administrator Account Management

**Files:**
- Modify: `web/src/auth/client/accountApi.ts`
- Modify: `web/src/auth/client/accountApi.test.ts`
- Modify: `web/src/features/admin/UsersTeamsPage.tsx`
- Modify: `web/src/features/admin/UserFormModal.tsx`
- Create: `web/src/features/admin/ResetPasswordModal.tsx`
- Create: `web/src/features/admin/AccountStatusModal.tsx`
- Create: `web/src/features/admin/accountManagement.test.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Consumes: persistent administrator APIs, `syncAccount()`, reusable `Modal`, toast notifications.
- Produces: create/edit/reset/enable/disable UI and account filters.

- [ ] **Step 1: Write failing account-client tests**

Add typed methods:

```ts
listAccounts(): Promise<AccountPublic[]>
createAccount(input: CreateAccountInput): Promise<AccountPublic>
updateAccount(id: string, input: UpdateAccountInput): Promise<AccountPublic>
resetAccountPassword(id: string, password: string): Promise<{ reauthenticate: boolean }>
setAccountStatus(id: string, status: AccountStatus): Promise<AccountPublic>
listAccountAudit(): Promise<AccountAuditLog[]>
```

Tests assert HTTP methods and exact URLs, including URL-encoding account IDs, and assert a 409 duplicate response becomes `AccountApiError(409, "用户名已存在")`.

- [ ] **Step 2: Run the client tests and verify RED**

Run: `pnpm test -- src/auth/client/accountApi.test.ts`

Expected: FAIL because administrator methods do not exist.

- [ ] **Step 3: Implement administrator client methods**

Use one private `requestJson<T>()` with `credentials: "same-origin"`, JSON content type, and safe error parsing. `resetAccountPassword()` parses `{ reauthenticate }` from a successful 200 response.

- [ ] **Step 4: Write failing account-management UI tests**

Render the administrator route with initial accounts and mock the typed client. Cover:

```tsx
it("creates another administrator and updates the account list", async () => {
  await user.click(screen.getByRole("button", { name: "新增账号" }));
  await user.type(screen.getByLabelText("显示名称"), "管理员2");
  await user.type(screen.getByLabelText("用户名"), "admin2");
  await user.type(screen.getByLabelText("初始密码"), "admin234");
  await user.selectOptions(screen.getByLabelText("角色"), "admin");
  await user.click(screen.getByRole("button", { name: "创建账号" }));
  expect(createAccount).toHaveBeenCalledWith(expect.objectContaining({
    username: "admin2",
    role: "admin",
    teamId: undefined,
  }));
  expect(screen.getByText("管理员2")).toBeVisible();
});
```

Use this explicit test setup:

```tsx
const adminAccount: AccountPublic = {
  id: "U-ADMIN-01",
  displayName: "管理员",
  username: "admin",
  role: "admin",
  status: "active",
  updatedAt: 1_722_708_000_000,
};
const initialAccounts = [adminAccount];

vi.mock("../../auth/client/accountApi", () => ({
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  resetAccountPassword: vi.fn(),
  setAccountStatus: vi.fn(),
}));

function renderAdminAccounts() {
  return render(
    <InteractionProvider>
      <DemoStoreProvider currentAccount={adminAccount} accounts={initialAccounts}>
        <UsersTeamsPage />
      </DemoStoreProvider>
    </InteractionProvider>,
  );
}
```

Bind `createAccount`, `updateAccount`, `resetAccountPassword`, and `setAccountStatus` with `vi.mocked()` before each test and restore them after each test.

Also test edit, role/team validation, search, role/status filters, reset-password confirmation mismatch, disable confirmation, self-disable error, and double-submit prevention.

- [ ] **Step 5: Rework the account list and create/edit form**

`UsersTeamsPage` uses `state.users` as its initial account snapshot, filters locally, and calls typed APIs for mutations. Replace `新增用户` with `新增账号`. Table columns are:

```text
账号 | 用户名 | 角色 | 所属团队 | 状态 | 更新时间 | 操作
```

`UserFormModal` receives async callbacks instead of calling `DemoStore.addUser/updateUser`:

```ts
onCreate(input: CreateAccountInput): Promise<AccountPublic>
onUpdate(id: string, input: UpdateAccountInput): Promise<AccountPublic>
```

Create mode includes initial password; edit mode omits password and allows display name and username edits. Admin role hides/clears team. Successful API results call `syncAccount()` and show `账号已创建` or `账号信息已更新`.

After this page is migrated, remove `addUser` and `updateUser` from `DemoStoreValue` so production components cannot create client-only pseudo-accounts. The underlying direct store helpers may remain temporarily for isolated store tests, but no page or context consumer may call them.

- [ ] **Step 6: Implement password reset and status confirmation modals**

`ResetPasswordModal` contains `新密码` and `确认新密码`; it checks equality before calling the API and never stores either value after close. When the API returns `reauthenticate: true` for the current administrator, clear the modal and navigate to `/login` because the reset invalidated the current session.

`AccountStatusModal` displays the target account and exact action. Disable copy warns `停用后该账号的已登录会话将立即失效。`. Both modals use local submitting refs/states, disable during requests, restore focus, and surface API errors in `role="alert"`.

- [ ] **Step 7: Run administrator UI and service regressions**

Run:

```bash
pnpm test -- src/features/admin/accountManagement.test.tsx src/auth/client/accountApi.test.ts src/auth/server/accountService.test.ts src/components/Modal.test.tsx
pnpm typecheck
```

Expected: all selected tests pass.

- [ ] **Step 8: Commit account management**

```bash
git add web/src/auth/client web/src/features/admin/UsersTeamsPage.tsx web/src/features/admin/UserFormModal.tsx web/src/features/admin/ResetPasswordModal.tsx web/src/features/admin/AccountStatusModal.tsx web/src/features/admin/accountManagement.test.tsx web/app/globals.css
git commit -m "feat: add administrator account management"
```

---

### Task 8: Generic Test Identities, Account Audit, and Team Invitation Boundary

**Files:**
- Modify: `web/src/data/demoData.ts`
- Modify: `web/src/data/demoStore.ts`
- Modify: `web/src/data/demoStore.test.ts`
- Modify: `web/src/features/admin/AuditLogPage.tsx`
- Create: `web/src/features/admin/AuditLogPage.test.tsx`
- Modify: `web/src/features/team/TeamDashboard.tsx`
- Modify: `web/src/features/team/MembersPage.tsx`
- Modify: `web/src/features/team/teamInteractions.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: exact initial account map, `listAccountAudit()`, shared notifications.
- Produces: consistent generic display names, persistent audit rendering, and an administrator-only account-creation boundary.

- [ ] **Step 1: Write failing identity and audit tests**

Add a store test that asserts:

```ts
expect(demoSeed.users.map(({ name, account, role }) => ({ name, account, role })))
  .toEqual([
    { name: "测试人员1", account: "ceshirenyuan1", role: "collector" },
    { name: "团长1", account: "tuanzhang1", role: "leader" },
    { name: "管理员", account: "admin", role: "admin" },
    { name: "测试人员2", account: "ceshirenyuan2", role: "collector" },
    { name: "测试人员3", account: "ceshirenyuan3", role: "collector" },
    { name: "测试人员4", account: "ceshirenyuan4", role: "collector" },
    { name: "测试人员5", account: "ceshirenyuan5", role: "collector" },
    { name: "团长2", account: "tuanzhang2", role: "leader" },
  ]);
expect(demoSeed.submissions.find((item) => item.id === "SUB-001")?.ownerName)
  .toBe("测试人员1");
```

Add `AuditLogPage.test.tsx` that mocks `listAccountAudit()` with a `reset_password` row and asserts it appears together with `生成结算批次` from demo logs.

The test defines the same `adminAccount` and `initialAccounts` constants from Task 7, then renders the real page under `InteractionProvider` and `DemoStoreProvider currentAccount={adminAccount} accounts={initialAccounts}`. Mock only `listAccountAudit()`; do not mock `AuditLogPage`, the demo store, or log mapping.

- [ ] **Step 2: Run identity and audit tests and verify RED**

Run: `pnpm test -- src/data/demoStore.test.ts src/features/admin/AuditLogPage.test.tsx`

Expected: FAIL because current names are personal demo names and account audits are not loaded.

- [ ] **Step 3: Replace every seeded personal display name consistently**

Apply this exact map to users, submission `ownerName`, withdrawal `userName`, operation-log actors, and seeded audit actors:

```ts
const displayNameByUserId = {
  "U-ADMIN-01": "管理员",
  "U-LEAD-01": "团长1",
  "U-LEAD-02": "团长2",
  "U-COL-01": "测试人员1",
  "U-COL-02": "测试人员2",
  "U-COL-03": "测试人员3",
  "U-COL-04": "测试人员4",
  "U-COL-05": "测试人员5",
} as const;
```

Set usernames to the values in the design spec and retain existing IDs, teams, phone masks, business amounts, and submission ownership.

- [ ] **Step 4: Render persistent account audit safely**

`AuditLogPage` fetches `listAccountAudit()` on mount only for administrators, maps action codes to Chinese labels, formats `createdAt` in Asia/Shanghai, and merges them before demo operation logs. On fetch failure, keep demo logs visible and show `账户日志加载失败` without inventing records.

- [ ] **Step 5: Enforce administrator-only account creation in team pages**

The existing leader `邀请成员` buttons must not create login accounts. Keep the button for discoverability, but replace the form opening with:

```ts
notify("info", "请联系管理员在“用户与团队”中创建账号");
```

Remove `InviteMemberModal` from production rendering and update team tests to assert the informational feedback and unchanged member count. Retain the store's existing invitation command only until a future business-request workflow replaces it; it must not be exposed through page controls.

Remove `inviteMember` from `DemoStoreValue` at the same time. The direct store command may remain for its isolated unit test, but authenticated product UI must have no client-only account creation path.

- [ ] **Step 6: Update README with real login behavior**

Document:

- initial `admin`, `tuanzhang1/2`, and `ceshirenyuan1–5` credentials;
- accounts are durable and created only by administrators;
- password reset and account status behavior;
- business workflow data remains demo/session-only;
- the initial administrator password should be reset before long-term public use.

- [ ] **Step 7: Run identity, audit, team, and complete regressions**

Run:

```bash
pnpm test -- src/data/demoStore.test.ts src/features/admin/AuditLogPage.test.tsx src/features/team/teamInteractions.test.tsx
pnpm test
pnpm typecheck
```

Expected: all tests pass and no personal demo names remain in user-facing seed data.

- [ ] **Step 8: Commit integrated account behavior**

```bash
git add README.md web/src/data web/src/features/admin/AuditLogPage.tsx web/src/features/admin/AuditLogPage.test.tsx web/src/features/team
git commit -m "feat: integrate persistent accounts across workspaces"
```

---

### Task 9: Final Security, Migration, Build, and Deployment Verification

**Files:**
- Modify: `web/tests/rendered-html.test.mjs`
- Modify: `README.md`
- Inspect: `web/drizzle/0000_account-authentication.sql`
- Inspect: `web/.openai/hosting.json`

**Interfaces:**
- Consumes: the complete account feature and Sites D1 packaging.
- Produces: verified source, migration, documentation, and a deployable production version.

- [ ] **Step 1: Add failing rendered-output and secret-leak checks**

Extend `tests/rendered-html.test.mjs` to assert the server-rendered `/login` response contains `用户名`, `密码`, and `登录`, does not contain `选择演示身份`, and does not embed `admin123`.

Add a test that reads the migration and built client assets and rejects matches for these plaintext password assignments:

```js
assert.doesNotMatch(migration, /admin123|tuanzhang1|ceshirenyuan1/);
assert.doesNotMatch(clientAssets, /admin123|passwordHash|passwordSalt/);
```

Define `clientAssets` with a real recursive reader rooted at `dist/client/assets`:

```js
async function readTreeText(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const parts = await Promise.all(entries.map((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directoryUrl);
    return entry.isDirectory() ? readTreeText(child) : readFile(child, "utf8");
  }));
  return parts.join("\n");
}

const clientAssets = await readTreeText(new URL("../dist/client/assets/", import.meta.url));
const migration = await readFile(
  new URL("../drizzle/0000_account-authentication.sql", import.meta.url),
  "utf8",
);
```

Do not reject `tuanzhang1` or `ceshirenyuan1` from client assets: those values are legitimate public usernames as well as the requested initial passwords. Password behavior tests and API-response tests, rather than a string search, prove those plaintext values are never returned as password fields.

- [ ] **Step 2: Run render tests and verify RED**

Run: `pnpm test:render`

Expected: FAIL before the production build is refreshed or because the new login assertions are not yet satisfied.

- [ ] **Step 3: Run the complete fresh verification sequence**

Run in order:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:render
git diff --check
git status --short
```

Expected:

- zero failing tests;
- zero type or lint errors;
- successful vinext production build;
- two or more passing rendered-HTML tests;
- only intentional source, migration, documentation, and lockfile changes;
- existing `.pnpm-store/` and `web/pnpm-workspace.yaml` remain untouched and uncommitted.

- [ ] **Step 4: Inspect security and requirement checklists**

Confirm all of these with code searches and tests:

```bash
rg -n "loginAs\(|演示角色|选择演示身份" src app
rg -n "admin123" dist/client drizzle
rg -n "passwordHash|passwordSalt|evdp_session" dist/client/assets
```

Expected:

- no production page exposes `loginAs` or demo-role controls;
- `admin123` appears only in the server bootstrap chunk and README, never client assets, migration SQL, logs, or HTML; pinyin strings may legitimately appear as usernames;
- password hashes/salts never appear in client assets or public API types;
- `evdp_session` appears only in server-side cookie handling.

- [ ] **Step 5: Commit the verified feature**

```bash
git add README.md web/tests/rendered-html.test.mjs
git commit -m "test: verify persistent account authentication"
```

- [ ] **Step 6: Publish the D1-backed site**

Use `sites:sites-hosting` after the final build:

1. push the exact validated branch head to the configured Sites source repository;
2. package `dist`, `.openai/hosting.json`, and `drizzle/**` with the Sites package helper;
3. save one version using the pushed commit SHA;
4. deploy privately when the access policy permits, otherwise request explicit approval for the resolved shared/public access level;
5. poll the deployment to a terminal state;
6. open the successful deployed URL in Codex;
7. log in as `admin / admin123`, create a temporary collector through the UI, sign out, sign in with that collector, refresh, and confirm persistence only if the user explicitly requests browser testing. Without that request, rely on automated service, D1, build, and deployment verification.

Expected: deployment succeeds and the existing site URL serves the new login page and D1-backed account APIs.

---

## Plan Coverage Map

- Persistent schema, D1 binding, migrations, indexes: Task 1.
- Password hashing and session-token security: Task 2.
- Real D1 repository and eight initial accounts: Task 3.
- Login lockout, sessions, admin operations, server APIs, audit: Task 4.
- Server role protection and scoped account data: Task 5.
- Username/password login, no role switch, logout: Task 6.
- Administrator create/edit/reset/enable/disable UI: Task 7.
- Generic account names, account-audit display, administrator-only creation boundary, docs: Task 8.
- Secret checks, regression suite, build, migration packaging, and deployment: Task 9.
