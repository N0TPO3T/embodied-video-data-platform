import * as argon2 from "argon2";
import type { DataSource } from "typeorm";

import { bootstrapLocalIdentity } from "../src/cli/bootstrap-local-identity.js";
import { createDataSource } from "../src/database/data-source.js";
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
});
