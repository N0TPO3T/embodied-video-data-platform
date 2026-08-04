// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureInitialAccounts } from "./bootstrapAccounts";
import { createD1AccountRepository } from "./d1AccountRepository";
import {
  makeAccountRecord,
  makeAudit,
  makeResetAudit,
} from "./testFactories";
import { createTestD1 } from "./testD1";

describe("D1 account repository", () => {
  let dispose: () => Promise<void>;
  let db: D1Database;

  beforeEach(async () => {
    ({ db, dispose } = await createTestD1());
  });

  afterEach(async () => {
    await dispose();
  });

  it("persists an account and retrieves it case-insensitively", async () => {
    const repo = createD1AccountRepository(db);
    const record = makeAccountRecord({
      id: "U-TEST-1",
      displayName: "测试管理员",
      username: "Admin.Two",
      usernameNormalized: "admin.two",
      role: "admin",
      teamId: undefined,
    });

    await repo.createAccount(record, makeAudit(record));

    await expect(
      repo.findByNormalizedUsername("admin.two"),
    ).resolves.toMatchObject({
      id: "U-TEST-1",
      username: "Admin.Two",
    });
  });

  it("atomically resets a password, clears sessions, and writes audit", async () => {
    const repo = createD1AccountRepository(db);
    const record = makeAccountRecord({
      id: "U-TEST-2",
      username: "reset.user",
      usernameNormalized: "reset.user",
    });
    await repo.createAccount(record, makeAudit(record));
    await repo.createSession("digest", record.id, 10, 1_000);

    await repo.resetPassword(
      { ...record, passwordHash: "next" },
      makeResetAudit(record),
    );

    await expect(repo.findSessionAccount("digest", 20)).resolves.toBeNull();
    await expect(repo.listAuditLogs(10)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "reset_password" }),
      ]),
    );
  });

  it("creates the eight initial accounts only once", async () => {
    const repo = createD1AccountRepository(db);

    await ensureInitialAccounts(repo, 1_722_700_000_000);
    await ensureInitialAccounts(repo, 1_722_700_000_000);

    const accounts = await repo.listAccounts({ kind: "all" });
    expect(accounts).toHaveLength(8);
    expect(accounts.filter((account) => account.role === "admin")).toHaveLength(
      1,
    );
    expect(
      accounts.filter((account) => account.role === "leader"),
    ).toHaveLength(2);
    expect(
      accounts.filter((account) => account.role === "collector"),
    ).toHaveLength(5);

    const admin = await repo.findByNormalizedUsername("admin");
    expect(admin?.passwordHash).not.toBe("admin123");
  });
});
