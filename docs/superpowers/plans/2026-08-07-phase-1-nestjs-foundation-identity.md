# Phase 1 NestJS Foundation and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the approved local production stack, migrate the existing D1 accounts into PostgreSQL with Argon2id passwords, enforce administrator/leader/collector boundaries in NestJS, and switch the existing Web login and account screens from D1 to the new API.

**Architecture:** Add a NestJS 11 modular monolith under `backend/` and run PostgreSQL, Redis, RabbitMQ, MinIO, and Qdrant with Docker Compose. PostgreSQL owns accounts, teams, sessions, and audit records; the existing D1 database is read only during an explicit import command. The existing Web application calls the NestJS API with credentialed requests and keeps the current page layout.

**Tech Stack:** Node.js 22, pnpm 11, NestJS 11.1, TypeORM 1.1, PostgreSQL 17, Redis 8, RabbitMQ 4, MinIO, Qdrant, Argon2id, Vitest 4, React 19, TypeScript 5.9.

## Global Constraints

- Implement only phase 1 identity and local foundation in this plan.
- Keep the current Web interface and do not deploy or synchronize it to Sites.
- Do not migrate DemoStore tasks, videos, scores, withdrawals, or settlements.
- Import D1 accounts, roles, team assignments, statuses, and account audit only.
- Convert every imported plaintext prototype password to Argon2id before inserting it into PostgreSQL.
- Never print, return, persist in reports, or commit plaintext passwords.
- Do not import D1 sessions; every user signs in again after cutover.
- Roles are exactly `admin`, `leader`, and `collector`.
- Administrators can manage all accounts and teams.
- Leaders can create, rename, reset, enable, and disable collectors in their own team only.
- Collectors can read only their own account.
- At least one active administrator must remain.
- Password reset, disable, role change, and team change revoke the affected account sessions.
- API authorization is authoritative; hidden Web controls are not security boundaries.
- Missing AI credentials must not prevent phase 1 services from starting.
- Preserve unrelated tracked and untracked workspace files.

## Target File Structure

```text
backend/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── Dockerfile
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/environment.ts
│   ├── database/data-source.ts
│   ├── database/entities/{team,user,session,audit-log}.entity.ts
│   ├── database/migrations/202608070001-identity.ts
│   ├── health/{health.controller,health.module}.ts
│   ├── auth/{auth.controller,auth.module,auth.service,password.service,session.guard,current-user.decorator}.ts
│   ├── identity/{accounts.controller,accounts.service,identity.module,teams.controller,teams.service,identity.policy}.ts
│   ├── audit/{audit.controller,audit.module,audit.service}.ts
│   └── cli/{import-d1.ts,seed-identity.ts}.ts
└── test/
    ├── health.e2e-spec.ts
    ├── auth.e2e-spec.ts
    ├── identity-policy.spec.ts
    ├── accounts.e2e-spec.ts
    └── import-d1.spec.ts
web/
├── app/[[...slug]]/page.tsx
├── src/auth/client/accountApi.ts
├── src/auth/server/backendClient.ts
├── src/features/team/MembersPage.tsx
└── src/features/team/CollectorAccountFormModal.tsx
compose.yaml
.env.example
```

---

### Task 1: Bootstrap the NestJS API and Stable Health Contract

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/tsconfig.build.json`
- Create: `backend/nest-cli.json`
- Create: `backend/src/main.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/config/environment.ts`
- Create: `backend/src/health/health.controller.ts`
- Create: `backend/src/health/health.module.ts`
- Create: `backend/test/health.e2e-spec.ts`
- Create: `backend/vitest.config.ts`

**Interfaces:**
- Produces: `GET /api/v1/health/live`
- Response: `{ "status": "ok", "service": "evdp-api" }`
- Produces: validated `Environment` with `PORT`, `DATABASE_URL`, `WEB_ORIGIN`, `SESSION_SECRET`, and infrastructure URLs.

- [ ] **Step 1: Create the backend package and TypeScript configuration**

Use NestJS `11.1.x`, TypeORM `1.1.x`, `pg` `8.22.x`, `argon2` `0.45.x`, `class-validator` `0.15.x`, `class-transformer` `0.5.x`, Vitest `4.1.x`, and Supertest `7.2.x`. Add scripts `dev`, `build`, `start`, `test`, `test:e2e`, `typecheck`, `migration:run`, `migration:revert`, `seed:identity`, and `import:d1`.

- [ ] **Step 2: Write the failing health endpoint test**

```ts
it("returns the stable public liveness response", async () => {
  const response = await request(app.getHttpServer())
    .get("/api/v1/health/live")
    .expect(200);
  expect(response.body).toEqual({ status: "ok", service: "evdp-api" });
  expect(response.headers["cache-control"]).toBe("no-store");
});
```

- [ ] **Step 3: Run the focused test and verify failure**

Run: `pnpm --dir backend test:e2e -- health.e2e-spec.ts`

Expected: FAIL because `HealthModule` and the application bootstrap do not exist.

- [ ] **Step 4: Implement environment validation, global `/api/v1` prefix, CORS credentials, validation pipe, and health module**

The application must allow the configured Web origin, set `credentials: true`, reject unknown DTO fields, and return the exact liveness response from Step 2.

- [ ] **Step 5: Run the focused test, typecheck, and build**

Run:

```bash
pnpm --dir backend test:e2e -- health.e2e-spec.ts
pnpm --dir backend typecheck
pnpm --dir backend build
```

Expected: all commands exit with status 0.

### Task 2: Start the Approved Local Infrastructure

**Files:**
- Create: `compose.yaml`
- Create: `.env.example`
- Create: `backend/Dockerfile`
- Modify: `.gitignore`
- Test: `backend/test/environment.spec.ts`

**Interfaces:**
- Produces: PostgreSQL at `localhost:5432`
- Produces: Redis at `localhost:6379`
- Produces: RabbitMQ AMQP at `localhost:5672` and management UI at `localhost:15672`
- Produces: MinIO API at `localhost:9000` and console at `localhost:9001`
- Produces: Qdrant at `localhost:6333`
- Produces: API at `localhost:4000`

- [ ] **Step 1: Write failing environment validation tests**

```ts
it("rejects an empty session secret", () => {
  expect(() => parseEnvironment(validEnvironment({ SESSION_SECRET: "" })))
    .toThrow(/SESSION_SECRET/);
});

it("allows missing model credentials in phase one", () => {
  expect(parseEnvironment(validEnvironment({ QWEN_API_KEY: undefined })))
    .toMatchObject({ qwenApiKey: undefined });
});
```

- [ ] **Step 2: Run the environment tests and verify failure**

Run: `pnpm --dir backend test -- environment.spec.ts`

Expected: FAIL because `parseEnvironment` is not implemented.

- [ ] **Step 3: Implement `.env.example`, ignored `.env`, container health checks, named volumes, and non-default local credentials**

`compose.yaml` must declare health-based dependencies and persistent volumes for PostgreSQL, RabbitMQ, MinIO, and Qdrant. The API container starts only after PostgreSQL is healthy. Redis, RabbitMQ, MinIO, and Qdrant are started in phase 1 even though later phases consume them.

- [ ] **Step 4: Implement and test environment parsing**

Return a typed object and fail with one concise configuration error per invalid required value. Model credentials remain optional and are never assigned sample values.

- [ ] **Step 5: Validate the Compose file**

Run: `docker compose --env-file .env.example config`

Expected: status 0 and definitions for `api`, `postgres`, `redis`, `rabbitmq`, `minio`, and `qdrant`.

### Task 3: Create the PostgreSQL Identity Schema

**Files:**
- Create: `backend/src/database/data-source.ts`
- Create: `backend/src/database/database.module.ts`
- Create: `backend/src/database/entities/team.entity.ts`
- Create: `backend/src/database/entities/user.entity.ts`
- Create: `backend/src/database/entities/session.entity.ts`
- Create: `backend/src/database/entities/audit-log.entity.ts`
- Create: `backend/src/database/migrations/202608070001-identity.ts`
- Create: `backend/test/identity-schema.e2e-spec.ts`

**Interfaces:**
- Produces: `teams`, `users`, `sessions`, and `audit_logs` tables.
- `users.role`: `admin | leader | collector`
- `users.status`: `active | disabled`
- All timestamps use PostgreSQL `timestamptz` and are serialized as epoch milliseconds to the existing Web contract.

- [ ] **Step 1: Write a failing schema integration test**

The test starts from an empty PostgreSQL test database, runs migrations, inserts two teams and all three roles, verifies case-insensitive username uniqueness, verifies team foreign keys, and verifies cascade deletion of sessions without deleting audit rows.

- [ ] **Step 2: Run the schema test and verify failure**

Run: `pnpm --dir backend test:e2e -- identity-schema.e2e-spec.ts`

Expected: FAIL because the entities and migration are absent.

- [ ] **Step 3: Implement the four entities and explicit migration**

Use UUID-compatible string identifiers so existing IDs such as `U-ADMIN-01` and `TEAM-01` remain valid. Add indexes on normalized username, role/status, team, session expiry, and audit creation time. Do not enable TypeORM schema synchronization.

- [ ] **Step 4: Run migrations and the schema test**

Run:

```bash
docker compose up -d postgres
pnpm --dir backend migration:run
pnpm --dir backend test:e2e -- identity-schema.e2e-spec.ts
```

Expected: migration and test succeed.

### Task 4: Implement Argon2id Login and Revocable Sessions

**Files:**
- Create: `backend/src/auth/password.service.ts`
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/auth.module.ts`
- Create: `backend/src/auth/session.guard.ts`
- Create: `backend/src/auth/current-user.decorator.ts`
- Create: `backend/src/auth/dto/login.dto.ts`
- Create: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /api/v1/auth/login`
- Produces: `POST /api/v1/auth/logout`
- Produces: `GET /api/v1/auth/session`
- Cookie name: `evdp_session`
- Session token is random; only its SHA-256 hash is stored.

- [ ] **Step 1: Write failing authentication tests**

Cover successful login, wrong password, disabled account, five-attempt lockout, session lookup, logout, expired session rejection, and `HttpOnly; SameSite=Lax; Path=/` cookie attributes.

- [ ] **Step 2: Run the authentication tests and verify failure**

Run: `pnpm --dir backend test:e2e -- auth.e2e-spec.ts`

Expected: FAIL because the authentication module is absent.

- [ ] **Step 3: Implement password hashing and login**

Use Argon2id. Never compare or store a new password as plaintext. Generate 32 random token bytes, store only the SHA-256 digest, use a seven-day expiry, and clear the cookie on logout.

- [ ] **Step 4: Implement session guard and current-user decorator**

The guard rejects missing, expired, revoked, and disabled-account sessions. It attaches a public user object without the password hash.

- [ ] **Step 5: Run authentication tests and typecheck**

Run:

```bash
pnpm --dir backend test:e2e -- auth.e2e-spec.ts
pnpm --dir backend typecheck
```

Expected: status 0.

### Task 5: Enforce Account and Team Management Boundaries

**Files:**
- Create: `backend/src/identity/identity.policy.ts`
- Create: `backend/src/identity/accounts.service.ts`
- Create: `backend/src/identity/accounts.controller.ts`
- Create: `backend/src/identity/teams.service.ts`
- Create: `backend/src/identity/teams.controller.ts`
- Create: `backend/src/identity/identity.module.ts`
- Create: `backend/src/identity/dto/account.dto.ts`
- Create: `backend/src/identity/dto/team.dto.ts`
- Create: `backend/src/audit/audit.service.ts`
- Create: `backend/src/audit/audit.controller.ts`
- Create: `backend/src/audit/audit.module.ts`
- Create: `backend/test/identity-policy.spec.ts`
- Create: `backend/test/accounts.e2e-spec.ts`

**Interfaces:**
- Produces: `GET/POST /api/v1/accounts`
- Produces: `PATCH /api/v1/accounts/:id`
- Produces: `POST /api/v1/accounts/:id/reset-password`
- Produces: `PATCH /api/v1/accounts/:id/status`
- Produces: `GET/POST /api/v1/teams`
- Produces: `PATCH /api/v1/teams/:id`
- Produces: `GET /api/v1/audit-logs`

- [ ] **Step 1: Write policy tests as a role/action matrix**

Assert that administrators manage all roles and teams; leaders manage collectors in the actor team only; collectors read self only. Assert that leaders cannot change usernames, roles, or teams and cannot target leaders/admins.

- [ ] **Step 2: Run policy tests and verify failure**

Run: `pnpm --dir backend test -- identity-policy.spec.ts`

Expected: FAIL because `IdentityPolicy` is absent.

- [ ] **Step 3: Implement the pure policy and make unit tests pass**

Run: `pnpm --dir backend test -- identity-policy.spec.ts`

Expected: all matrix cases pass.

- [ ] **Step 4: Write failing API tests**

Cover administrator creation of every role, leader creation of an own-team collector, leader cross-team rejection, collector rejection, duplicate username, last-admin protection, session revocation, and audit creation in the same database transaction.

- [ ] **Step 5: Implement controllers and transactional services**

Return the existing `AccountPublic` shape. Every successful write creates an immutable audit row. Password reset returns `{ "reauthenticate": true }` only when an actor resets the actor's own password.

- [ ] **Step 6: Run identity API tests**

Run: `pnpm --dir backend test:e2e -- accounts.e2e-spec.ts`

Expected: all cases pass.

### Task 6: Import D1 Accounts Safely and Seed Test Identity Data

**Files:**
- Create: `backend/src/cli/import-d1.ts`
- Create: `backend/src/cli/seed-identity.ts`
- Create: `backend/test/import-d1.spec.ts`
- Create: `backend/test/seed-identity.spec.ts`

**Interfaces:**
- Consumes: path supplied by `D1_SQLITE_PATH`
- Produces: idempotent imported teams, users, and audit rows.
- Produces: test identity data only when PostgreSQL has no users.

- [ ] **Step 1: Write a failing import test using a temporary SQLite fixture**

Create one admin, one leader, one collector, two team IDs, one audit row, and one D1 session. Assert that users and audit import, sessions do not import, every password verifies as Argon2id afterward, and a second import creates no duplicates.

- [ ] **Step 2: Run the import test and verify failure**

Run: `pnpm --dir backend test -- import-d1.spec.ts`

Expected: FAIL because the importer is absent.

- [ ] **Step 3: Implement the importer without logging secrets**

Read the SQLite database in read-only mode. Infer teams from non-null D1 `team_id` values, preserve account IDs, hash each prototype password immediately, and report only counts and non-secret validation errors.

- [ ] **Step 4: Implement the identity seed**

When no imported accounts exist, create `TEST-ADMIN`, `TEST-LEADER`, and four `TEST-COLLECTOR` accounts in two clearly named test teams. Read initial passwords from `EVDP_TEST_ACCOUNT_PASSWORDS_JSON`; never commit default passwords.

- [ ] **Step 5: Run import and seed tests**

Run:

```bash
pnpm --dir backend test -- import-d1.spec.ts
pnpm --dir backend test -- seed-identity.spec.ts
```

Expected: status 0.

- [ ] **Step 6: Import the actual local D1 database**

Run the importer against `web/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`. Verify counts only and do not print credential fields.

### Task 7: Switch Web Authentication and Account Management to NestJS

**Files:**
- Create: `web/src/auth/server/backendClient.ts`
- Create: `web/src/features/team/CollectorAccountFormModal.tsx`
- Modify: `web/src/auth/client/accountApi.ts`
- Modify: `web/app/[[...slug]]/page.tsx`
- Modify: `web/src/features/team/MembersPage.tsx`
- Modify: `web/src/features/admin/UsersTeamsPage.tsx`
- Modify: `web/src/auth/client/accountApi.test.ts`
- Create: `web/src/auth/server/backendClient.test.ts`
- Create: `web/src/features/team/leaderAccountManagement.test.tsx`

**Interfaces:**
- Browser API base: `NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:4000/api/v1`
- Server API base: `BACKEND_INTERNAL_URL`, default `http://localhost:4000/api/v1`
- Existing `AccountPublic`, `CreateAccountInput`, and `UpdateAccountInput` remain stable.

- [ ] **Step 1: Write failing client and server API tests**

Assert credentialed calls use `/api/v1`, server calls forward the `evdp_session` cookie, and a backend 401 causes route access to redirect to `/login`.

- [ ] **Step 2: Run focused Web tests and verify failure**

Run:

```bash
pnpm --dir web test -- src/auth/client/accountApi.test.ts
pnpm --dir web test -- src/auth/server/backendClient.test.ts
```

Expected: at least one failure because the backend client is absent.

- [ ] **Step 3: Implement public and server API clients**

Use `credentials: "include"` for browser requests. Forward only the session cookie server-side. Preserve backend error codes and Chinese user messages.

- [ ] **Step 4: Replace server-side D1 route authentication**

`page.tsx` reads the cookie, calls the NestJS session endpoint, loads only the accounts visible to the current actor, and keeps `DemoStoreProvider` only for business screens not yet migrated.

- [ ] **Step 5: Add leader collector management UI**

The team members page provides create, rename, password reset, enable, and disable actions for collectors. The form never allows a leader to select another role or team.

- [ ] **Step 6: Run focused and full Web checks**

Run:

```bash
pnpm --dir web test
pnpm --dir web typecheck
pnpm --dir web build
```

Expected: status 0.

### Task 8: Verify the Phase 1 Local Cutover

**Files:**
- Create: `backend/test/phase1-smoke.e2e-spec.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: documented one-command infrastructure startup.
- Produces: verified login and account management flow backed by PostgreSQL.

- [ ] **Step 1: Write the smoke test**

The test logs in as administrator, lists accounts, logs in as leader, creates a collector in the leader team, rejects a cross-team action, disables the collector, verifies the collector session is rejected, and confirms audit rows.

- [ ] **Step 2: Run all backend checks**

Run:

```bash
pnpm --dir backend test
pnpm --dir backend test:e2e
pnpm --dir backend typecheck
pnpm --dir backend build
```

Expected: status 0.

- [ ] **Step 3: Start the local stack and verify health**

Run:

```bash
docker compose up -d --build
docker compose ps
curl --fail http://localhost:4000/api/v1/health/live
```

Expected: infrastructure services are healthy and the API returns `{"status":"ok","service":"evdp-api"}`.

- [ ] **Step 4: Verify the existing Web UI**

Open `http://localhost:3000/login`, log in with an imported account, verify the correct role home page, and perform one permitted account action. Confirm PostgreSQL and audit records change while D1 remains unchanged.

- [ ] **Step 5: Document local setup and phase boundary**

README must describe environment creation, startup, account import, health checks, test commands, service URLs, safe shutdown, and the fact that video/AI/settlement remain in later phases.

