import { DataSource } from "typeorm";

import { createDataSource } from "../src/database/data-source.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { SessionEntity } from "../src/database/entities/session.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

describe("identity database schema", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("persists teams and all three account roles", async () => {
    const teams = dataSource.getRepository(TeamEntity);
    const users = dataSource.getRepository(UserEntity);
    await teams.save([
      teams.create({ id: "TEAM-01", name: "测试一队" }),
      teams.create({ id: "TEAM-02", name: "测试二队" }),
    ]);
    await users.save([
      users.create({
        id: "U-ADMIN",
        displayName: "管理员",
        username: "Admin",
        usernameNormalized: "admin",
        passwordHash: "argon-hash",
        role: "admin",
      }),
      users.create({
        id: "U-LEADER",
        displayName: "团长",
        username: "Leader",
        usernameNormalized: "leader",
        passwordHash: "argon-hash",
        role: "leader",
        teamId: "TEAM-01",
      }),
      users.create({
        id: "U-COLLECTOR",
        displayName: "数采人员",
        username: "Collector",
        usernameNormalized: "collector",
        passwordHash: "argon-hash",
        role: "collector",
        teamId: "TEAM-01",
      }),
    ]);

    expect(await users.count()).toBe(3);
    expect((await users.findOneByOrFail({ id: "U-LEADER" })).teamId).toBe(
      "TEAM-01",
    );
  });

  it("enforces case-insensitive username uniqueness", async () => {
    const users = dataSource.getRepository(UserEntity);
    await expect(
      users.save(
        users.create({
          id: "U-DUPLICATE",
          displayName: "重复账号",
          username: "ADMIN",
          usernameNormalized: "ADMIN",
          passwordHash: "argon-hash",
          role: "collector",
          teamId: "TEAM-02",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cascades sessions but retains immutable audit rows", async () => {
    const users = dataSource.getRepository(UserEntity);
    const sessions = dataSource.getRepository(SessionEntity);
    const audit = dataSource.getRepository(AuditLogEntity);
    await sessions.save(
      sessions.create({
        tokenHash: "a".repeat(64),
        accountId: "U-COLLECTOR",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    await audit.save(
      audit.create({
        id: "AUD-01",
        actorAccountId: "U-ADMIN",
        actorName: "管理员",
        action: "disable",
        targetAccountId: "U-COLLECTOR",
        targetName: "数采人员",
        summary: "测试审计记录",
      }),
    );

    await users.delete({ id: "U-COLLECTOR" });

    expect(await sessions.count()).toBe(0);
    expect(await audit.count()).toBe(1);
  });
});
