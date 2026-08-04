// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { hashPassword } from "../password";
import {
  createAccountService,
  type AccountService,
} from "./accountService";
import { createD1AccountRepository } from "./d1AccountRepository";
import {
  makeAccountPublic,
  makeAccountRecord,
  makeAudit,
} from "./testFactories";
import { createTestD1 } from "./testD1";

const disposers: Array<() => Promise<void>> = [];
const TEST_PASSWORD = "test-password-admin";
const NEXT_TEST_PASSWORD = "test-password-next";

afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

async function accountServiceFixture(): Promise<{
  service: AccountService;
  repo: ReturnType<typeof createD1AccountRepository>;
  admin: ReturnType<typeof makeAccountPublic>;
}> {
  const { db, dispose } = await createTestD1();
  disposers.push(dispose);
  const repo = createD1AccountRepository(db);
  const stored = await hashPassword(
    TEST_PASSWORD,
    new Uint8Array(16).fill(3),
  );
  const adminRecord = makeAccountRecord({
    id: "U-ADMIN-01",
    displayName: "管理员",
    username: "admin",
    usernameNormalized: "admin",
    role: "admin",
    teamId: undefined,
    passwordHash: stored.hash,
    passwordSalt: stored.salt,
    passwordIterations: stored.iterations,
    updatedAt: 1_722_708_000_000,
    createdAt: 1_722_708_000_000,
  });
  await repo.createAccount(adminRecord, makeAudit(adminRecord));

  let sequence = 1;
  const service = createAccountService(repo, {
    now: () => 1_722_708_100_000,
    createId: () => `U-NEW-${sequence++}`,
  });
  const admin = makeAccountPublic({
    id: adminRecord.id,
    displayName: adminRecord.displayName,
    username: adminRecord.username,
    role: "admin",
    teamId: undefined,
    updatedAt: adminRecord.updatedAt,
  });
  return { service, repo, admin };
}

describe("AccountService", () => {
  it("allows an administrator to create all supported roles", async () => {
    const { service, admin } = await accountServiceFixture();

    await expect(
      service.create(admin, {
        displayName: "管理员2",
        username: "admin2",
        password: "admin234",
        role: "admin",
      }),
    ).resolves.toMatchObject({ role: "admin", teamId: undefined });
    await expect(
      service.create(admin, {
        displayName: "团长3",
        username: "tuanzhang3",
        password: "tuanzhang3",
        role: "leader",
        teamId: "TEAM-01",
      }),
    ).resolves.toMatchObject({ role: "leader", teamId: "TEAM-01" });
    await expect(
      service.create(admin, {
        displayName: "测试人员6",
        username: "ceshirenyuan6",
        password: "ceshirenyuan6",
        role: "collector",
        teamId: "TEAM-02",
      }),
    ).resolves.toMatchObject({
      role: "collector",
      teamId: "TEAM-02",
    });
  });

  it("rejects case-insensitive duplicate usernames", async () => {
    const { service, admin } = await accountServiceFixture();

    await expect(
      service.create(admin, {
        displayName: "重复管理员",
        username: "ADMIN",
        password: "admin456",
        role: "admin",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "用户名已存在",
    });
  });

  it("updates safe account fields but preserves the last active administrator", async () => {
    const { service, admin } = await accountServiceFixture();

    await expect(
      service.update(admin, admin.id, {
        displayName: "管理员",
        username: "admin",
        role: "collector",
        teamId: "TEAM-01",
      }),
    ).rejects.toThrow("系统必须保留至少一个启用的管理员");

    const secondAdmin = await service.create(admin, {
      displayName: "管理员2",
      username: "admin2",
      password: "admin234",
      role: "admin",
    });
    await expect(
      service.update(admin, secondAdmin.id, {
        displayName: "团长3",
        username: "leader3",
        role: "leader",
        teamId: "TEAM-02",
      }),
    ).resolves.toMatchObject({
      displayName: "团长3",
      username: "leader3",
      role: "leader",
      teamId: "TEAM-02",
    });
  });

  it("resets a password, invalidates sessions, and requests reauthentication for self", async () => {
    const { service, repo, admin } = await accountServiceFixture();
    await repo.createSession("digest", admin.id, 10, 10_000);

    await expect(
      service.resetPassword(admin, admin.id, NEXT_TEST_PASSWORD),
    ).resolves.toEqual({ reauthenticate: true });
    await expect(repo.findSessionAccount("digest", 20)).resolves.toBeNull();
    await expect(repo.listAuditLogs(10)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "reset_password",
          summary: "管理员重置了账号密码",
        }),
      ]),
    );
  });

  it("prevents self-disable and disabling the last active administrator", async () => {
    const { service, admin } = await accountServiceFixture();

    await expect(
      service.setStatus(admin, admin.id, "disabled"),
    ).rejects.toThrow("不能停用当前登录账号");

    const onlyAdminViewedByAnotherAdmin = {
      ...admin,
      id: "U-ADMIN-GHOST",
    };
    await expect(
      service.setStatus(onlyAdminViewedByAnotherAdmin, admin.id, "disabled"),
    ).rejects.toThrow("系统必须保留至少一个启用的管理员");
  });

  it("limits visible accounts to the actor's authorization scope", async () => {
    const { service, repo, admin } = await accountServiceFixture();
    const leader = makeAccountRecord({
      id: "U-LEAD-01",
      displayName: "团长1",
      username: "leader1",
      usernameNormalized: "leader1",
      role: "leader",
      teamId: "TEAM-01",
    });
    const collector = makeAccountRecord({
      id: "U-COL-01",
      displayName: "测试人员1",
      username: "collector1",
      usernameNormalized: "collector1",
      role: "collector",
      teamId: "TEAM-01",
    });
    await repo.createAccount(leader, {
      ...makeAudit(leader),
      id: "AUD-LEADER",
    });
    await repo.createAccount(collector, {
      ...makeAudit(collector),
      id: "AUD-COLLECTOR",
    });

    await expect(
      service.listVisible(makeAccountPublic(leader)),
    ).resolves.toHaveLength(2);
    await expect(
      service.listVisible(makeAccountPublic(collector)),
    ).resolves.toEqual([
      expect.objectContaining({ id: "U-COL-01" }),
    ]);
    await expect(service.listVisible(admin)).resolves.toHaveLength(3);
  });
});
