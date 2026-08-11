import { randomUUID } from "node:crypto";

import * as argon2 from "argon2";
import type { DataSource } from "typeorm";

import {
  seedIdentity,
  TEST_IDENTITY_USERNAMES,
} from "../src/cli/seed-identity.js";
import { createDataSource } from "../src/database/data-source.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

describe("identity seed", () => {
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

  it("creates clearly marked test accounts only in an empty database", async () => {
    const passwords = Object.fromEntries(
      TEST_IDENTITY_USERNAMES.map((username) => [
        username,
        `Runtime-${randomUUID()}-password`,
      ]),
    );
    const result = await seedIdentity({ dataSource, passwords });

    expect(result).toEqual({
      created: true,
      teamsCreated: 2,
      accountsCreated: 7,
    });
    expect(await dataSource.getRepository(TeamEntity).count()).toBe(2);
    expect(await dataSource.getRepository(UserEntity).count()).toBe(7);
    const admin = await dataSource.getRepository(UserEntity).findOneByOrFail({
      usernameNormalized: "test-admin",
    });
    expect(admin.displayName).toContain("测试");
    expect(
      await argon2.verify(admin.passwordHash, passwords["test-admin"]!),
    ).toBe(true);

    expect(await seedIdentity({ dataSource, passwords })).toEqual({
      created: false,
      teamsCreated: 0,
      accountsCreated: 0,
    });
  });
});
