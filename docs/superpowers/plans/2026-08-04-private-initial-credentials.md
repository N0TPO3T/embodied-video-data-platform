# Private Initial Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove live initial passwords from the public repository while preserving the approved credentials through a private Sites runtime secret.

**Architecture:** Keep bootstrap identity metadata in source and inject an `INITIAL_ACCOUNT_PASSWORDS` JSON secret only when an empty D1 account table must be seeded. Bootstrap validates the complete secret before hashing and inserting any account; existing databases bypass the secret path and remain unchanged.

**Tech Stack:** TypeScript 5.9, Cloudflare Workers environment bindings, Cloudflare D1, Web Crypto PBKDF2, Vitest, Sites hosting, GitHub Git Data API.

## Global Constraints

- Keep all currently approved usernames and passwords unchanged.
- No live initial password may appear in tracked source, README, migrations, browser bundles, or build metadata.
- Existing D1 accounts and password changes must not be overwritten.
- Missing or invalid secret configuration must fail before any account is inserted.
- Runtime errors must never echo secret values.
- `INITIAL_ACCOUNT_PASSWORDS` must be stored as a secret Sites environment variable.
- Publish the exact validated `main` snapshot to both Sites and the public GitHub repository.

---

### Task 1: Secret-backed bootstrap credentials

**Files:**
- Create: `web/src/auth/server/initialCredentials.ts`
- Create: `web/src/auth/server/initialCredentials.test.ts`
- Modify: `web/src/auth/server/bootstrapAccounts.ts`
- Modify: `web/src/auth/server/d1AccountRepository.test.ts`
- Modify: `web/src/auth/server/runtime.ts`

**Interfaces:**
- Produces: `parseInitialAccountPasswords(raw: unknown, usernames: readonly string[]): Record<string, string>`.
- Changes: `ensureInitialAccounts(repo, rawCredentials, now?)` checks table emptiness before parsing credentials.
- Consumes: `env.INITIAL_ACCOUNT_PASSWORDS` as an optional unknown runtime value.

- [ ] **Step 1: Write failing parser tests**

Add tests that pass a JSON object containing test-only passwords for every seed username and assert the parsed map. Add separate cases for missing JSON, malformed JSON, incomplete usernames, extra usernames, and values outside the 8–64 character range; each failure must equal `初始账号密码配置无效`.

- [ ] **Step 2: Run parser tests and verify RED**

Run: `node_modules/.bin/vitest run src/auth/server/initialCredentials.test.ts`

Expected: FAIL because `initialCredentials.ts` does not exist.

- [ ] **Step 3: Implement strict secret parsing**

Implement `parseInitialAccountPasswords()` so it accepts only a JSON object whose sorted keys exactly equal the supplied username list and whose values pass the existing `validatePassword()` rule. Catch JSON and validation failures and throw only `初始账号密码配置无效`.

- [ ] **Step 4: Write failing bootstrap integration tests**

Update the real D1 repository test to inject a JSON map of test-only passwords, verify one seeded hash with `verifyPassword()`, assert that an incomplete map leaves the table empty, and assert that a second bootstrap call with a missing secret succeeds once accounts already exist.

- [ ] **Step 5: Run bootstrap tests and verify RED**

Run: `node_modules/.bin/vitest run src/auth/server/d1AccountRepository.test.ts`

Expected: FAIL because bootstrap still embeds passwords and does not accept the secret argument.

- [ ] **Step 6: Remove passwords from definitions and wire runtime secret**

Change each seed definition tuple to `[id, displayName, username, role, teamId]`. In `ensureInitialAccounts()`, return immediately for a non-empty table, then parse the injected secret and hash the password selected by username. In `runtime.ts`, pass `(env as typeof env & { INITIAL_ACCOUNT_PASSWORDS?: string }).INITIAL_ACCOUNT_PASSWORDS`.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `node_modules/.bin/vitest run src/auth/server/initialCredentials.test.ts src/auth/server/d1AccountRepository.test.ts`

Expected: both files pass with no plaintext live credentials in stored rows or errors.

### Task 2: Public-source credential regression

**Files:**
- Modify: `README.md`
- Modify: `web/tests/rendered-html.test.mjs`
- Modify: authentication tests containing the former live administrator password

**Interfaces:**
- Produces: public documentation that lists usernames only.
- Produces: a source regression test reading README, bootstrap source, client source, and migration SQL.

- [ ] **Step 1: Write the failing public-source regression**

Extend `rendered-html.test.mjs` to read `README.md` and `src/auth/server/bootstrapAccounts.ts`. Assert structurally that README has no ``username / password`` credential pairs, each bootstrap tuple has only five non-secret identity fields, and browser-facing code exposes none of the server-only password record fields.

- [ ] **Step 2: Run the source regression and verify RED**

Run: `node --test tests/rendered-html.test.mjs`

Expected: FAIL because README still contains credential pairs and bootstrap tuples still include a password field.

- [ ] **Step 3: Remove live password literals from tracked files**

Change README to list usernames and state `初始密码由管理员通过私密渠道提供`. Replace live-password literals in automated tests with explicit test-only constants such as `test-password-123`; keep username assertions unchanged.

- [ ] **Step 4: Run the source regression and focused auth tests**

Run: `node --test tests/rendered-html.test.mjs`

Run: `node_modules/.bin/vitest run src/auth`

Expected: all checks pass. A structural search of bootstrap tuples and README credential-pair formatting returns no matches, without placing live password values in commands, plans, or repository files.

- [ ] **Step 5: Commit the credential hardening**

Stage only the credential parser, bootstrap/runtime changes, tests, README, rendered-source regression, design, and plan. Commit with `fix: keep initial credentials private`.

### Task 3: Validate, configure, publish, and synchronize

**Files:**
- Build output: `web/dist/**` (not committed)
- Runtime configuration: Sites `INITIAL_ACCOUNT_PASSWORDS` secret (not stored locally)
- Remote target: `owoTomCat/embodied-video-data-platform` branch `main`

**Interfaces:**
- Consumes: the approved private credential map supplied directly to Sites.
- Produces: a deployed Sites version and an exact public GitHub source snapshot.

- [ ] **Step 1: Run complete local verification**

Run from `web/`:

```bash
node_modules/.bin/vitest run
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint . --ignore-pattern dist --ignore-pattern .next
node_modules/.bin/vinext build
node --test tests/rendered-html.test.mjs
```

Expected: 0 failed tests, 0 type errors, 0 lint errors, successful production build, and successful rendered-page checks.

- [ ] **Step 2: Save the private runtime secret**

Update Sites environment variable `INITIAL_ACCOUNT_PASSWORDS` with the unchanged approved eight-account map and mark it secret. Do not place the value in a file, command output, commit, or user-facing response.

- [ ] **Step 3: Push and package the exact validated source**

Push current `main` to the existing Sites source repository using a short-lived per-command credential. Package `web/dist`, `.openai/hosting.json`, and `web/drizzle` with the Sites packaging helper, then save a version using the pushed HEAD SHA.

- [ ] **Step 4: Deploy and verify terminal status**

Deploy the saved version to the already-approved public site. Poll the deployment until `succeeded` or `failed`; on success, open the returned production URL in Codex.

- [ ] **Step 5: Initialize and publish GitHub main**

Because the GitHub repository is empty, create a harmless root commit, upload every tracked blob from current HEAD (base64 for binary files), create one complete tree and snapshot commit, and move `main` to that commit without force-updating any pre-existing user history.

- [ ] **Step 6: Verify GitHub snapshot**

Read repository metadata and representative files from GitHub `main`, compare the published tree/file contents to current HEAD, and confirm the public repository contains no live credential values.
