#!/usr/bin/env node
// Credential regression check (runs in CI).
//
// Guarantees that live local-default credentials never reappear in the public
// repository outside the explicit allowlist. Add new allowlist entries only
// when a tracked file legitimately requires the literal (see comments below).
//
// Run: node scripts/check-no-credentials.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

const KNOWN_DEFAULT_PASSWORDS = ["admin123", "team1234", "user1234"];

// Files that legitimately carry the local starter credentials:
//  - bootstrap-local-identity.ts: local-only starter accounts source of truth
//    (production refuses to seed them unless EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS=true)
//  - its spec: asserts the exact starter credentials
//  - bootstrap-production-identity.sh: ephemeral production bootstrap that seeds
//    the starter accounts then immediately rotates every password to a random one
//  - docs/superpowers/*: historical design/plan archives from before the
//    credential-hardening policy; kept as read-only audit trail
const ALLOWLIST = new Set([
  "backend/src/cli/bootstrap-local-identity.ts",
  "backend/test/bootstrap-local-identity.spec.ts",
  "deploy/bootstrap-production-identity.sh",
  "docs/superpowers/plans/2026-08-04-account-authentication.md",
  "docs/superpowers/plans/2026-08-11-local-persistent-identity.md",
  "docs/superpowers/specs/2026-08-04-account-authentication-design.md",
  "docs/superpowers/specs/2026-08-11-local-persistent-identity-design.md",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
  ".zip", ".tar", ".gz", ".tgz", ".mp4", ".mov", ".wasm",
  ".woff", ".woff2", ".ttf", ".eot", ".lockb", ".snap",
]);

// User-facing docs must never advertise credential pairs, e.g. a markdown table
// mapping usernames to passwords, or `password: "value"` / `密码：xxx`.
// These checks only apply to files outside the ALLOWLIST above (historical
// design archives are baseline-exempt; README and any new docs are guarded).
const DOC_TABLE_MAPS_USERNAME_TO_PASSWORD =
  /^\s*\|[^|]*(用户名|账号|username)[^|]*\|[^|]*(密码|password|口令)[^|]*\|/i;
const DOC_QUOTED_PASSWORD_VALUE =
  /(密码|password|口令)\s*["'`]?\s*[:=|：]\s*["'`][^"'`]{4,}["'`]/i;
const DOC_CN_PASSWORD_VALUE = /(密码|口令)\s*[:=|：]\s*[^，。；、\s"'`]{4,}/;

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const failures = [];

for (const file of tracked) {
  const ext = extname(file).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) continue;

  const content = readFileSync(join(process.cwd(), file), "utf8");

  if (!ALLOWLIST.has(file)) {
    for (const password of KNOWN_DEFAULT_PASSWORDS) {
      if (content.includes(password)) {
        failures.push(
          `${file} contains local default password "${password}" (add to allowlist only if intentional)`,
        );
      }
    }
  }

  // Doc-level checks guard only README.md, the user-facing surface. The docs/
  // archive is historical development material; default-password literals there
  // are handled by the ALLOWLIST + Check 1 above.
  if (file === "README.md") {
    for (const [index, line] of content.split("\n").entries()) {
      if (DOC_TABLE_MAPS_USERNAME_TO_PASSWORD.test(line)) {
        failures.push(
          `${file}:${index + 1} markdown table maps usernames to passwords: ${line.trim()}`,
        );
      }
      if (DOC_QUOTED_PASSWORD_VALUE.test(line) || DOC_CN_PASSWORD_VALUE.test(line)) {
        failures.push(
          `${file}:${index + 1} exposes a credential value next to a password keyword: ${line.trim()}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Credential regression check FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `Credential regression check passed: no default passwords outside allowlist, ` +
    `no credential pairs advertised in README/docs (${tracked.length} tracked files scanned).`,
);
