import * as argon2 from "argon2";
import type { DataSource } from "typeorm";

import { bootstrapLocalIdentity } from "../src/cli/bootstrap-local-identity.js";
import { createDataSource } from "../src/database/data-source.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { SessionEntity } from "../src/database/entities/session.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

const expectedAccounts = [
  {
    username: "admin",
    displayName: "管理员",
    role: "admin",
    teamId: null,
    password: "admin123",
  },
  {
    username: "tuanzhang1",
    displayName: "团长1",
    role: "leader",
    teamId: "TEAM-01",
    password: "team1234",
  },
  {
    username: "tuanzhang2",
    displayName: "团长2",
    role: "leader",
    teamId: "TEAM-02",
    password: "team1234",
  },
  {
    username: "ceshirenyuan1",
    displayName: "数采人员1",
    role: "collector",
    teamId: "TEAM-01",
    password: "user1234",
  },
  {
    username: "ceshirenyuan2",
    displayName: "数采人员2",
    role: "collector",
    teamId: "TEAM-01",
    password: "user1234",
  },
  {
    username: "ceshirenyuan3",
    displayName: "数采人员3",
    role: "collector",
    teamId: "TEAM-01",
    password: "user1234",
  },
  {
    username: "ceshirenyuan4",
    displayName: "数采人员4",
    role: "collector",
    teamId: "TEAM-02",
    password: "user1234",
  },
  {
    username: "ceshirenyuan5",
    displayName: "数采人员5",
    role: "collector",
    teamId: "TEAM-02",
    password: "user1234",
  },
] as const;

describe("production-local identity bootstrap", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
  });

  beforeEach(async () => {
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("creates the approved active local identities from an empty database", async () => {
    // This fails if the bootstrap omits, misassigns, disables, or stores a
    // plaintext/incorrect credential for any approved local account.
    const result = await bootstrapLocalIdentity({
      dataSource,
      mode: "create-if-empty",
    });

    expect(result).toEqual({
      applied: true,
      teamsCreated: 2,
      accountsCreated: 8,
    });
    expect(Object.keys(result)).toEqual([
      "applied",
      "teamsCreated",
      "accountsCreated",
    ]);

    expect(
      (await dataSource.getRepository(TeamEntity).find({ order: { id: "ASC" } })).map(
        (team) => team.id,
      ),
    ).toEqual(["TEAM-01", "TEAM-02"]);

    const accounts = await dataSource.getRepository(UserEntity).find({
      order: { usernameNormalized: "ASC" },
    });
    expect(accounts).toHaveLength(8);

    for (const expected of expectedAccounts) {
      const account = accounts.find(
        (candidate) => candidate.usernameNormalized === expected.username,
      );
      expect(account).toMatchObject({
        username: expected.username,
        usernameNormalized: expected.username,
        displayName: expected.displayName,
        role: expected.role,
        teamId: expected.teamId,
        status: "active",
      });
      expect(account).toBeDefined();
      expect(account!.passwordHash).not.toBe(expected.password);
      expect(await argon2.verify(account!.passwordHash, expected.password)).toBe(
        true,
      );
    }
  });

  it("preserves an existing team's operational fields while creating only missing teams", async () => {
    // This fails if bootstrap upserts a pre-existing team and overwrites
    // operational data that does not belong to identity initialization.
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-01",
      name: "保留的现场团队名称",
      status: "disabled",
      unitPricePerMinute: "456.7890",
    });

    const result = await bootstrapLocalIdentity({
      dataSource,
      mode: "create-if-empty",
    });

    expect(result).toEqual({
      applied: true,
      teamsCreated: 1,
      accountsCreated: 8,
    });
    expect(await dataSource.getRepository(TeamEntity).findOneByOrFail({ id: "TEAM-01" }))
      .toMatchObject({
        name: "保留的现场团队名称",
        status: "disabled",
        unitPricePerMinute: "456.7890",
      });
    expect(await dataSource.getRepository(TeamEntity).findOneByOrFail({ id: "TEAM-02" }))
      .toMatchObject({ id: "TEAM-02" });
  });

  it("leaves existing identities untouched after an API restart", async () => {
    await bootstrapLocalIdentity({
      dataSource,
      mode: "create-if-empty",
    });
    const users = dataSource.getRepository(UserEntity);
    const admin = await users.findOneByOrFail({ usernameNormalized: "admin" });
    const preservedHash = await argon2.hash("not-the-bootstrap-password", {
      type: argon2.argon2id,
    });
    await users.update(admin.id, {
      displayName: "已修改管理员",
      passwordHash: preservedHash,
    });
    await dataSource.destroy();

    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    const result = await bootstrapLocalIdentity({
      dataSource,
      mode: "create-if-empty",
    });

    expect(result).toEqual({
      applied: false,
      teamsCreated: 0,
      accountsCreated: 0,
    });
    const preservedAdmin = await dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ usernameNormalized: "admin" });
    expect(preservedAdmin.displayName).toBe("已修改管理员");
    expect(preservedAdmin.passwordHash).toBe(preservedHash);
  });

  it("reconciles only starter identities once while preserving real accounts and sessions", async () => {
    // This fails if reconciliation finds a canonical ID before the normalized
    // username, rewrites non-starter records, leaves stale starter sessions,
    // records credentials in audits, or changes rows again on a rerun.
    const teams = dataSource.getRepository(TeamEntity);
    const users = dataSource.getRepository(UserEntity);
    const sessions = dataSource.getRepository(SessionEntity);
    const audits = dataSource.getRepository(AuditLogEntity);
    const expiredAt = new Date("2030-01-01T00:00:00.000Z");
    const failedAt = new Date("2029-01-01T00:00:00.000Z");

    await teams.save([
      {
        id: "TEAM-01",
        name: "已配置团队",
        status: "active",
        unitPricePerMinute: "456.7890",
      },
      {
        id: "TEAM-REAL",
        name: "真实业务团队",
        status: "active",
        unitPricePerMinute: "12.5000",
      },
    ]);

    const [legacyAdminHash, legacyLeaderHash, realAccountHash] =
      await Promise.all([
        argon2.hash("different-admin-password", { type: argon2.argon2id }),
        argon2.hash("different-leader-password", { type: argon2.argon2id }),
        argon2.hash("real-account-password", { type: argon2.argon2id }),
      ]);
    await users.save([
      {
        id: "U-LEGACY-ADMIN",
        username: "admin",
        usernameNormalized: "admin",
        displayName: "旧管理员",
        role: "admin",
        teamId: null,
        status: "disabled",
        passwordHash: legacyAdminHash,
        failedAttemptCount: 2,
        firstFailedAt: failedAt,
        lockedUntil: failedAt,
      },
      {
        id: "U-LEGACY-LEADER",
        username: "tuanzhang1",
        usernameNormalized: "tuanzhang1",
        displayName: "旧团长",
        role: "collector",
        teamId: "TEAM-01",
        status: "disabled",
        passwordHash: legacyLeaderHash,
        failedAttemptCount: 5,
        firstFailedAt: failedAt,
        lockedUntil: failedAt,
      },
      {
        id: "U-REAL-01",
        username: "field-operator",
        usernameNormalized: "field-operator",
        displayName: "现场真实账号",
        role: "leader",
        teamId: "TEAM-REAL",
        status: "active",
        passwordHash: realAccountHash,
        failedAttemptCount: 3,
        firstFailedAt: failedAt,
        lockedUntil: failedAt,
      },
    ]);
    await sessions.save([
      {
        tokenHash: "a".repeat(64),
        accountId: "U-LEGACY-LEADER",
        expiresAt: expiredAt,
      },
      {
        tokenHash: "b".repeat(64),
        accountId: "U-REAL-01",
        expiresAt: expiredAt,
      },
    ]);

    await bootstrapLocalIdentity({
      dataSource,
      mode: "reconcile",
    });

    expect(await teams.findOneByOrFail({ id: "TEAM-01" })).toMatchObject({
      name: "已配置团队",
      status: "active",
      unitPricePerMinute: "456.7890",
    });
    expect(await teams.findOneByOrFail({ id: "TEAM-02" })).toMatchObject({
      id: "TEAM-02",
      name: "团队2",
      status: "active",
      unitPricePerMinute: "0.0000",
    });

    const reconciledAccounts = await users.find({
      order: { usernameNormalized: "ASC" },
    });
    expect(reconciledAccounts).toHaveLength(9);
    for (const expected of expectedAccounts) {
      const account = reconciledAccounts.find(
        (candidate) => candidate.usernameNormalized === expected.username,
      );
      expect(account).toMatchObject({
        username: expected.username,
        usernameNormalized: expected.username,
        displayName: expected.displayName,
        role: expected.role,
        teamId: expected.teamId,
        status: "active",
        failedAttemptCount: 0,
        firstFailedAt: null,
        lockedUntil: null,
      });
      expect(await argon2.verify(account!.passwordHash, expected.password)).toBe(
        true,
      );
    }
    expect(
      reconciledAccounts.find(
        (account) => account.usernameNormalized === "admin",
      )!.id,
    ).toBe("U-LEGACY-ADMIN");
    expect(
      reconciledAccounts.find(
        (account) => account.usernameNormalized === "tuanzhang1",
      )!.id,
    ).toBe("U-LEGACY-LEADER");

    expect(await users.findOneByOrFail({ id: "U-REAL-01" })).toMatchObject({
      username: "field-operator",
      displayName: "现场真实账号",
      role: "leader",
      teamId: "TEAM-REAL",
      status: "active",
      passwordHash: realAccountHash,
      failedAttemptCount: 3,
      firstFailedAt: failedAt,
      lockedUntil: failedAt,
    });
    expect(await sessions.findOneBy({ tokenHash: "a".repeat(64) })).toBeNull();
    expect(await sessions.findOneBy({ tokenHash: "b".repeat(64) })).toMatchObject({
      accountId: "U-REAL-01",
      expiresAt: expiredAt,
    });

    const reconcileAudits = await audits.find({
      where: { action: "local_identity_reconcile" },
      order: { targetAccountId: "ASC" },
    });
    expect(reconcileAudits).toHaveLength(expectedAccounts.length);
    for (const account of reconciledAccounts.filter((candidate) =>
      expectedAccounts.some(
        (expected) => expected.username === candidate.usernameNormalized,
      ),
    )) {
      const audit = reconcileAudits.find(
        (candidate) => candidate.targetAccountId === account.id,
      );
      expect(audit).toMatchObject({
        actorAccountId: "system",
        actorName: "system",
        action: "local_identity_reconcile",
        targetAccountId: account.id,
        targetName: account.displayName,
      });
      expect(JSON.stringify(audit)).not.toMatch(/password/i);
    }

    const snapshot = async () => ({
      teams: (await teams.find({ order: { id: "ASC" } })).map((team) => ({
        id: team.id,
        name: team.name,
        status: team.status,
        unitPricePerMinute: team.unitPricePerMinute,
        updatedAt: team.updatedAt.toISOString(),
      })),
      users: (await users.find({ order: { id: "ASC" } })).map((user) => ({
        id: user.id,
        username: user.username,
        usernameNormalized: user.usernameNormalized,
        displayName: user.displayName,
        role: user.role,
        teamId: user.teamId,
        passwordHash: user.passwordHash,
        status: user.status,
        failedAttemptCount: user.failedAttemptCount,
        firstFailedAt: user.firstFailedAt?.toISOString() ?? null,
        lockedUntil: user.lockedUntil?.toISOString() ?? null,
        updatedAt: user.updatedAt.toISOString(),
      })),
      sessions: (await sessions.find({ order: { tokenHash: "ASC" } })).map(
        (session) => ({
          tokenHash: session.tokenHash,
          accountId: session.accountId,
          expiresAt: session.expiresAt.toISOString(),
        }),
      ),
      audits: (await audits.find({ order: { id: "ASC" } })).map((audit) => ({
        id: audit.id,
        actorAccountId: audit.actorAccountId,
        actorName: audit.actorName,
        action: audit.action,
        targetAccountId: audit.targetAccountId,
        targetName: audit.targetName,
        summary: audit.summary,
        beforeValue: audit.beforeValue,
        afterValue: audit.afterValue,
      })),
    });
    const stateAfterFirstReconcile = await snapshot();

    await bootstrapLocalIdentity({
      dataSource,
      mode: "reconcile",
    });

    expect(await snapshot()).toEqual(stateAfterFirstReconcile);
  });
});
