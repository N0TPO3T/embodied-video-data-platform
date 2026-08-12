# Local Persistent Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the local username/password system fully runnable and persistent, install the approved starter accounts, add self-service password changes, remove the obsolete D1 identity runtime, and prove role isolation plus persistence against PostgreSQL.

**Architecture:** NestJS remains the only identity authority. PostgreSQL stores users, teams, Argon2id password hashes, revocable sessions, and audit logs in the existing persistent Docker volume. A production-local bootstrap command creates starter identities only when the users table is empty; an explicit one-time reconciliation mode aligns the already-running local database without changing passwords on later restarts. The Vinext UI receives identity data from a dedicated backend-backed context, while DemoStore remains only for business modules that have not yet been migrated.

**Tech Stack:** Node.js 22, pnpm 11, NestJS 11, TypeORM 1.1, PostgreSQL 17, Argon2id, React 19, Vinext/Next 16, Vitest 4, Supertest 7, Docker Compose.

---

## Global constraints

- Preserve all unrelated tracked and untracked workspace changes.
- Follow test-driven development: add one focused failing test, observe the expected failure, implement the minimum code, then rerun the focused test.
- Verify D1 removal through build/runtime behavior and obsolete-route behavior; do not add tests that merely scan source text for forbidden strings.
- Never delete or recreate the current PostgreSQL Docker volume.
- Never log or return plaintext passwords, password hashes, raw session tokens, or cookies.
- Starter passwords are the user-approved known local defaults. They are unsuitable for any network-exposed deployment.
- Normal API startup may create starter identities only when the users table is empty. It must never reset an existing password.
- The explicit reconciliation operation is run once for this existing installation and is not part of normal restart behavior.
- API authorization is authoritative; frontend route guards and hidden buttons are only interaction aids.
- Do not publish or deploy the site. Keep `.openai/hosting.json`, but remove the unused D1 binding from it.
- After all implementation and verification succeed, publish only the scoped project changes to a new `codex/` branch on the configured GitHub remote and open a draft pull request.

## Task 1: Add the production-local identity bootstrap

**Files:**

- Create: `backend/src/cli/bootstrap-local-identity.ts`
- Create: `backend/test/bootstrap-local-identity.spec.ts`
- Modify: `backend/package.json`
- Modify: `backend/Dockerfile`
- Keep unchanged: `backend/src/cli/seed-identity.ts` (test-data-only command)

### Step 1: Write the empty-database bootstrap test

Add an integration test that starts from a migrated empty test database and calls an exported function with `mode: "create-if-empty"`.

Assert exactly:

- teams `TEAM-01` and `TEAM-02` exist;
- users `admin`, `tuanzhang1`, `tuanzhang2`, and `ceshirenyuan1` through `ceshirenyuan5` exist;
- roles and team assignments match the approved design;
- all accounts are active;
- `argon2.verify` accepts `admin123`, `team1234`, or `user1234` as appropriate;
- no stored hash equals its plaintext password;
- the returned summary contains counts but no credential or hash fields.

Run:

```bash
cd backend
pnpm test -- bootstrap-local-identity.spec.ts
```

Expected: FAIL because `bootstrap-local-identity.ts` does not exist.

### Step 2: Implement canonical starter definitions and create-if-empty mode

Export immutable definitions with these canonical identities:

```ts
export const LOCAL_STARTER_ACCOUNTS = [
  { id: "U-ADMIN-01", username: "admin", displayName: "管理员", role: "admin", teamId: null, password: "admin123" },
  { id: "U-LEAD-01", username: "tuanzhang1", displayName: "团长1", role: "leader", teamId: "TEAM-01", password: "team1234" },
  { id: "U-LEAD-02", username: "tuanzhang2", displayName: "团长2", role: "leader", teamId: "TEAM-02", password: "team1234" },
  { id: "U-COL-01", username: "ceshirenyuan1", displayName: "数采人员1", role: "collector", teamId: "TEAM-01", password: "user1234" },
  { id: "U-COL-02", username: "ceshirenyuan2", displayName: "数采人员2", role: "collector", teamId: "TEAM-01", password: "user1234" },
  { id: "U-COL-03", username: "ceshirenyuan3", displayName: "数采人员3", role: "collector", teamId: "TEAM-01", password: "user1234" },
  { id: "U-COL-04", username: "ceshirenyuan4", displayName: "数采人员4", role: "collector", teamId: "TEAM-02", password: "user1234" },
  { id: "U-COL-05", username: "ceshirenyuan5", displayName: "数采人员5", role: "collector", teamId: "TEAM-02", password: "user1234" },
] as const;
```

Inside one TypeORM transaction:

1. acquire a PostgreSQL transaction-scoped advisory lock;
2. count users again inside the transaction;
3. return `{ applied: false, ...zeroCounts }` when any user exists;
4. create both teams;
5. Argon2id-hash all eight passwords;
6. create all eight users;
7. return only non-sensitive counts.

Do not emit bootstrap audit rows for the empty database because no user action occurred and the initial rows themselves establish the installation state.

### Step 3: Prove restart idempotency

Extend the test:

1. bootstrap once;
2. change the administrator display name and password hash to distinct values;
3. destroy and recreate the TypeORM `DataSource` to simulate an API restart;
4. call `create-if-empty` again;
5. assert `applied: false` and assert the changed name/hash were not overwritten.

Run the test and observe PASS.

### Step 4: Add the CLI and API-container startup hook

Add package scripts:

```json
"bootstrap:local-identity": "tsx src/cli/bootstrap-local-identity.ts",
"reconcile:local-identity": "tsx src/cli/bootstrap-local-identity.ts --reconcile"
```

The CLI must initialize and destroy its own `DataSource`, print only the result counts as JSON, and never print definitions or errors containing passwords.

Change the API image command to:

```dockerfile
CMD ["sh", "-c", "node dist/database/run-migrations.js && node dist/cli/bootstrap-local-identity.js && node dist/main.js"]
```

Run:

```bash
cd backend
pnpm test -- bootstrap-local-identity.spec.ts
pnpm typecheck
pnpm build
```

Expected: all pass.

## Task 2: Add one-time reconciliation for the current database

**Files:**

- Modify: `backend/src/cli/bootstrap-local-identity.ts`
- Modify: `backend/test/bootstrap-local-identity.spec.ts`

### Step 1: Write reconciliation tests

Seed a database with:

- an existing `admin` account with a different valid password;
- one starter username using a non-canonical ID;
- one missing starter account;
- an unrelated real account;
- active sessions for starter and unrelated accounts.

Call `mode: "reconcile"` and assert:

- all starter usernames have the approved role, team, status, display name, and approved initial password;
- an existing account keeps its existing primary key when found by normalized username;
- missing accounts are created;
- unrelated accounts and their sessions are unchanged;
- starter-account sessions are revoked;
- each changed starter account gets an audit row with actor ID/name `system`, action `local_identity_reconcile`, and no password fields;
- running reconciliation a second time makes no additional data changes or audit entries.

Run the focused test and observe the expected failure.

### Step 2: Implement reconciliation without upsert hazards

Within one locked transaction:

1. create missing canonical teams, but do not overwrite a team price already configured by the user;
2. locate users by normalized username before considering the canonical ID;
3. create a missing account or update only approved starter identity fields;
4. hash the approved password only when the stored password does not already verify against it;
5. clear failed-login state and revoke sessions only for changed starter users;
6. write sanitized system audit rows only for changed users;
7. preserve unrelated accounts, business rows, and sessions.

The command must not accept passwords on the command line. The approved local defaults come only from the canonical local definition.

### Step 3: Run the full bootstrap suite

```bash
cd backend
pnpm test -- bootstrap-local-identity.spec.ts seed-identity.spec.ts
pnpm typecheck
```

Expected: PASS, proving test-data seeding and real local bootstrapping remain separate.

## Task 3: Add database readiness and explicit persistence checks

**Files:**

- Modify: `backend/src/health/health.controller.ts`
- Modify: `backend/src/health/health.module.ts`
- Modify: `backend/test/health.e2e-spec.ts`
- Modify: `compose.yaml`

### Step 1: Write a failing readiness contract test

Add:

```ts
it("reports PostgreSQL readiness without exposing connection details", async () => {
  const response = await request(app.getHttpServer())
    .get("/api/v1/health/ready")
    .expect(200);
  expect(response.body).toEqual({
    status: "ready",
    service: "evdp-api",
    database: "ready",
  });
  expect(JSON.stringify(response.body)).not.toMatch(/postgresql:|password|DATABASE_URL/i);
});
```

Run and observe 404.

### Step 2: Implement readiness

Inject TypeORM `DataSource`, run a minimal `SELECT 1`, and return only the stable public shape. On failure, return HTTP 503 with `{ status: "not_ready", service: "evdp-api", database: "unavailable" }` and no driver error details.

Keep `/health/live` as a dependency-free liveness endpoint.

### Step 3: Switch the Compose API health check

Change only the API container health check from `/health/live` to `/health/ready`. Keep the existing PostgreSQL named volume and all non-destructive restart behavior.

Run:

```bash
cd backend
pnpm test -- health.e2e-spec.ts
cd ..
docker compose config
```

Expected: test passes and Compose config resolves successfully.

## Task 4: Add authenticated self-service password changes

**Files:**

- Modify: `backend/src/identity/dto/account.dto.ts`
- Modify: `backend/src/identity/accounts.service.ts`
- Modify: `backend/src/identity/accounts.controller.ts`
- Modify: `backend/src/identity/identity.policy.ts` only if a dedicated self-policy helper improves clarity
- Modify: `backend/test/accounts.e2e-spec.ts`

### Step 1: Write the failing API tests

Cover:

- `POST /api/v1/accounts/me/change-password` requires a valid session and allowed Origin;
- the current password is required and verified;
- the new password must be 8–64 characters;
- a wrong current password returns a safe validation error and changes nothing;
- success returns 204 and clears `evdp_session`;
- success stores an Argon2id hash, revokes every session for the actor, and writes `change_password` audit without sensitive values;
- another account cannot be targeted through this endpoint.

Run the focused accounts test and observe 404/failure.

### Step 2: Implement DTO, service transaction, and controller route

Use this input contract:

```ts
export class ChangeOwnPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  newPassword!: string;
}
```

The service transaction must reload the actor, verify the current hash, hash the new password with `PasswordService`, reset failed-login fields, delete all actor sessions, and write one sanitized audit row. The controller uses `SessionGuard` and `AllowedOriginGuard`, clears the cookie, and returns 204.

### Step 3: Run backend identity verification

```bash
cd backend
pnpm test -- accounts.e2e-spec.ts auth.e2e-spec.ts identity-policy.spec.ts
pnpm typecheck
pnpm build
```

Expected: all pass.

## Task 5: Move browser identity state out of DemoStore

**Files:**

- Create: `web/src/auth/client/IdentityContext.tsx`
- Create: `web/src/auth/client/IdentityContext.test.tsx`
- Modify: `web/src/auth/contracts.ts`
- Modify: `web/src/auth/client/accountApi.ts`
- Modify: `web/src/auth/client/accountApi.test.ts`
- Modify: `web/src/auth/server/backendClient.ts`
- Modify: `web/src/auth/server/backendClient.test.ts`
- Modify: `web/app/[[...slug]]/page.tsx`
- Modify: `web/src/data/DemoStoreContext.tsx`
- Modify: `web/src/layout/DashboardShell.tsx`
- Modify: `web/src/app/PlatformApp.tsx`

### Step 1: Write backend-client and context tests

Add a `TeamPublic` contract and an identity bootstrap shape containing `currentAccount`, visible `accounts`, and visible `teams`.

Tests must prove:

- server bootstrap forwards only `evdp_session` and fetches `/auth/session`, `/accounts`, and `/teams`;
- `IdentityProvider` exposes the backend-provided current account and teams;
- account/team upserts update context state without mutating DemoStore;
- `DashboardShell` and client role fallback read the authenticated role from `IdentityContext`.

Run the focused tests and observe failures because the context and team client do not exist.

### Step 2: Add real team API clients

Implement:

```ts
export type TeamPublic = {
  id: string;
  name: string;
  status: "active" | "disabled";
  unitPricePerMinute: number;
  createdAt: number;
  updatedAt: number;
};
```

Add browser `listTeams`, `createTeam`, and `updateTeam` clients only where the current UI consumes them. Add `listBackendTeams` for server rendering.

### Step 3: Add `IdentityProvider`

The provider owns backend-sourced account and team snapshots and exposes:

- `currentAccount`;
- `accounts` and `teams` visible to the actor;
- `upsertAccount` and `upsertTeam` after successful API mutations.

Wrap authenticated pages with it in `web/app/[[...slug]]/page.tsx`. Keep `DemoStoreProvider` only for incomplete video, quality, settlement, withdrawal, and similar business views. It may receive identity snapshots to render compatibility-domain objects, but it is no longer the source used by authorization, the shell identity chip, account tables, or team selectors.

### Step 4: Refactor shell and account screens to use real identity

Update `PlatformApp`, `DashboardShell`, `UsersTeamsPage`, `MembersPage`, `UserFormModal`, and `CollectorAccountFormModal` so their account/team membership, status, selectors, and role decisions come from `IdentityContext`. Preserve DemoStore metrics only where the UI labels them as business/demo metrics.

Run:

```bash
cd web
pnpm test -- src/auth src/app/PlatformApp.test.tsx src/layout src/features/admin src/features/team
pnpm typecheck
```

Expected: PASS.

## Task 6: Add a real account profile and password-change flow

**Files:**

- Create: `web/src/features/account/AccountProfilePage.tsx`
- Create: `web/src/features/account/AccountProfilePage.test.tsx`
- Modify: `web/src/auth/client/accountApi.ts`
- Modify: `web/src/auth/client/accountApi.test.ts`
- Modify: `web/src/app/navigation.ts`
- Modify: `web/src/app/PlatformApp.tsx`
- Modify: `web/src/app/PlatformApp.test.tsx`
- Modify: `web/src/auth/server/access.ts`
- Modify: `web/src/auth/server/access.test.ts`
- Delete: `web/src/features/collector/ProfilePage.tsx`

### Step 1: Write the password form tests

For administrator, leader, and collector contexts, prove `/account/profile`:

- shows backend-sourced display name, username, role, team, and status;
- has current password, new password, and confirmation fields;
- blocks mismatched confirmation and invalid lengths locally;
- calls the API exactly once with current/new password;
- clears fields and displays a safe server error on failure;
- redirects to `/login` after a successful 204 because all sessions were revoked;
- never renders any password value as text.

### Step 2: Implement browser API and page

Add:

```ts
export function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void>
```

Use `POST /accounts/me/change-password`, credentialed fetch, and the existing safe `AccountApiError` mapping.

Build the page from `IdentityContext`; remove simulated phone, Alipay, and “demo data saved” controls because they are not backed by the identity database.

### Step 3: Make profile navigation available to every role

Add `/account/profile` to all three navigation lists. Treat it as authenticated but role-neutral in both server and client route access. Remove the collector-only `/collector/profile` route and component.

Run:

```bash
cd web
pnpm test -- src/features/account src/auth/client/accountApi.test.ts src/app/PlatformApp.test.tsx src/auth/server/access.test.ts
pnpm typecheck
```

Expected: PASS.

## Task 7: Remove the obsolete D1 identity runtime

**Files:**

- Delete: `web/app/api/auth/login/route.ts`
- Delete: `web/app/api/auth/logout/route.ts`
- Delete: `web/app/api/auth/session/route.ts`
- Delete: `web/app/api/admin/account-audit/route.ts`
- Delete: `web/app/api/admin/accounts/route.ts`
- Delete: `web/app/api/admin/accounts/[id]/route.ts`
- Delete: `web/app/api/admin/accounts/[id]/reset-password/route.ts`
- Delete: `web/app/api/admin/accounts/[id]/status/route.ts`
- Delete: `web/src/auth/password.ts`
- Delete: `web/src/auth/password.test.ts`
- Delete: `web/src/auth/validation.ts`
- Delete: `web/src/auth/validation.test.ts`
- Delete: `web/src/auth/server/accountService.ts`
- Delete: `web/src/auth/server/accountService.test.ts`
- Delete: `web/src/auth/server/authService.ts`
- Delete: `web/src/auth/server/authService.test.ts`
- Delete: `web/src/auth/server/bootstrapAccounts.ts`
- Delete: `web/src/auth/server/d1AccountRepository.ts`
- Delete: `web/src/auth/server/d1AccountRepository.test.ts`
- Delete: `web/src/auth/server/http.ts`
- Delete: `web/src/auth/server/http.test.ts`
- Delete: `web/src/auth/server/initialCredentials.ts`
- Delete: `web/src/auth/server/initialCredentials.test.ts`
- Delete: `web/src/auth/server/runtime.ts`
- Delete: `web/src/auth/server/testD1.ts`
- Delete: `web/src/auth/server/testFactories.ts`
- Delete: `web/db/index.ts`
- Delete: `web/db/schema.ts`
- Delete: `web/drizzle.config.ts`
- Delete: `web/drizzle/0000_account-authentication.sql`
- Delete: `web/drizzle/meta/0000_snapshot.json`
- Delete: `web/drizzle/meta/_journal.json`
- Modify: `web/src/auth/contracts.ts`
- Modify: `web/package.json`
- Modify: `web/pnpm-lock.yaml`
- Modify: `web/.openai/hosting.json`
- Modify: `web/vite.config.ts`
- Modify: `web/cloudflare-env.d.ts`
- Modify: `web/worker/index.ts`
- Modify: `web/tests/rendered-html.test.mjs`
- Modify: tests that import `web/src/auth/server/testFactories.ts`

### Step 1: Replace shared test factories before deleting legacy files

Move the public-account-only factory into a non-D1 test helper such as `web/src/auth/testFactories.ts`, update active tests, and verify the focused active auth tests still pass.

### Step 2: Delete the legacy runtime and dependencies

Remove D1 account code and generated migration metadata. Remove the legacy repository/hash types from `web/src/auth/contracts.ts`. Remove `@noble/hashes`, `drizzle-orm`, `drizzle-kit`, and the `db:generate` script if no non-example runtime code uses them. Update `web/pnpm-lock.yaml` with pnpm after the dependency removals; do not hand-edit the lockfile.

Set the hosting D1 entry to `null`; remove the D1 binding from `vite.config.ts`, `cloudflare-env.d.ts`, and `worker/index.ts`. Preserve `.openai/hosting.json`, Vinext, the Cloudflare worker, image handling, and the Sites build plugin.

Do not delete `web/examples/d1` because it is a standalone template example and not imported by the product runtime.

### Step 3: Rewrite render and runtime-boundary tests

Replace assertions that inspect deleted source or migration text with behavioral assertions that:

- the Web application builds and server-renders without a D1 binding;
- obsolete same-origin D1 auth/account routes are absent while the NestJS login client still reaches the configured backend API;
- browser-facing login and account responses expose only public fields;
- the rendered login HTML does not expose starter passwords.

Use `rg` as a one-time implementation verification if useful, but do not add automated tests whose only behavior is scanning source strings.

Run:

```bash
cd web
pnpm install --frozen-lockfile
pnpm test -- src/auth src/features/auth
pnpm typecheck
pnpm build
pnpm test:render
```

Expected: all pass.

## Task 8: Document, calibrate, and verify the running installation

**Files:**

- Modify: `README.md`
- Modify: `.env.example` only if startup variables change
- Verify only: `.env`

### Step 1: Update local operating instructions

Document:

- exact approved local starter accounts;
- that credentials are known local defaults and must be changed before network exposure;
- first-start behavior and non-overwrite behavior on restart;
- explicit one-time reconciliation command;
- self-service password change and administrator reset behavior;
- `docker compose stop` preserves data;
- volume deletion is destructive and not part of normal operation;
- `/api/v1/health/ready` as the dependency readiness endpoint.

### Step 2: Run complete verification before touching current data

```bash
cd backend
pnpm test
pnpm typecheck
pnpm build

cd ../web
pnpm test
pnpm typecheck
pnpm build
pnpm test:render
pnpm lint

cd ..
docker compose config
```

Expected: all required tests, type checks, and builds pass. Lint must have no new warnings; pre-existing warnings must be reported explicitly.

### Step 3: Build and run the updated services

```bash
docker compose up -d --build api media-worker
docker compose ps
```

Wait until `/api/v1/health/ready` returns 200. Do not recreate volumes.

### Step 4: Apply the one-time current-database reconciliation

Run the built reconciliation command once inside the API image. Capture only the non-sensitive summary counts. Then restart the API normally and confirm normal startup reports no starter-account overwrite.

### Step 5: Verify all roles and persistence against the live stack

Using isolated cookie jars, verify:

- `admin / admin123` logs in and reaches `/admin`;
- both `tuanzhang* / team1234` accounts log in and reach `/team`;
- all five `ceshirenyuan* / user1234` accounts log in and reach `/collector`;
- administrator account listing returns all eight starters plus any unrelated existing accounts;
- a leader receives only its own-team accounts and team;
- a collector receives only itself and its team;
- a forbidden cross-team mutation returns 403;
- logout invalidates the session.

Restart the API container without deleting its volume, log in again, and verify the same account IDs and persisted rows remain.

### Step 6: Inspect storage safety without exposing secrets

Run aggregate-only database checks proving:

- every `password_hash` begins with the Argon2 encoding prefix and none equals an approved plaintext password;
- every session token value has exactly the SHA-256 hex digest shape;
- audit JSON/text does not contain password field names or approved password values;
- PostgreSQL row counts remain stable across restart.

Do not print full hashes, tokens, cookies, or environment secrets.

### Step 7: Browser smoke test

Open `http://localhost:3000/login` and verify:

- administrator login reaches the real admin workspace;
- refresh preserves the session;
- account/profile shows persisted identity data;
- logout returns to login;
- a leader and collector see their correct navigation and cannot open admin routes.

### Step 8: Final handoff

Report:

- service URLs and health status;
- the approved starter usernames and local passwords;
- tests/builds actually run and their results;
- persistence restart proof;
- any unrelated dirty-worktree changes left untouched;
- the warning that defaults must be changed before exposing the service beyond localhost.

## Task 9: Publish the verified changes to GitHub

**Files:**

- No product file changes expected; this task stages, commits, pushes, and opens a draft pull request.

### Step 1: Reconfirm the exact Git scope

Inspect `git status`, the scoped diff, and untracked files. Include only the persistent identity implementation, its tests, operating documentation, required backend/Compose foundation files already used by the implementation, and the two approved plan/spec documents. Exclude local databases, `.env`, caches, build output, dependency directories, temporary SDD artifacts, and unrelated pre-existing work.

### Step 2: Verify GitHub prerequisites

Run `gh --version`, `gh auth status`, inspect `origin`, and determine the remote default base branch. Stop only if the repository is not connected or authentication is unavailable.

### Step 3: Commit and push the new branch

Use the user-authorized branch `codex/persistent-local-auth` unless it already exists with unrelated history; in that case choose a similarly scoped unused `codex/` name. Stage explicit paths, create an intentional commit, and push with upstream tracking.

### Step 4: Open a draft pull request

Open a draft PR against the remote default branch. The body must summarize the persistent PostgreSQL identity bootstrap, password/session changes, frontend identity cutover, D1 removal, local verification, and the localhost-default-credential warning.

### Step 5: Report publication

Return the branch name, commit ID, PR URL, base branch, and validation summary. Do not claim publication until the push and PR creation both succeed.
