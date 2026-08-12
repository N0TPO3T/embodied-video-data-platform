import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as argon2 from "argon2";
import type { DataSource } from "typeorm";

import { createDataSource } from "../database/data-source.js";
import { TeamEntity } from "../database/entities/team.entity.js";
import {
  UserEntity,
  type UserRole,
} from "../database/entities/user.entity.js";

export const TEST_IDENTITY_USERNAMES = [
  "test-admin",
  "test-leader-01",
  "test-leader-02",
  "test-collector-01",
  "test-collector-02",
  "test-collector-03",
  "test-collector-04",
] as const;

type TestUsername = (typeof TEST_IDENTITY_USERNAMES)[number];

const definitions: Array<{
  id: string;
  displayName: string;
  username: TestUsername;
  role: UserRole;
  teamId: string | null;
}> = [
  {
    id: "TEST-ADMIN",
    displayName: "测试管理员",
    username: "test-admin",
    role: "admin",
    teamId: null,
  },
  {
    id: "TEST-LEADER-01",
    displayName: "测试一队团长",
    username: "test-leader-01",
    role: "leader",
    teamId: "TEST-TEAM-01",
  },
  {
    id: "TEST-LEADER-02",
    displayName: "测试二队团长",
    username: "test-leader-02",
    role: "leader",
    teamId: "TEST-TEAM-02",
  },
  {
    id: "TEST-COLLECTOR-01",
    displayName: "测试数采01",
    username: "test-collector-01",
    role: "collector",
    teamId: "TEST-TEAM-01",
  },
  {
    id: "TEST-COLLECTOR-02",
    displayName: "测试数采02",
    username: "test-collector-02",
    role: "collector",
    teamId: "TEST-TEAM-01",
  },
  {
    id: "TEST-COLLECTOR-03",
    displayName: "测试数采03",
    username: "test-collector-03",
    role: "collector",
    teamId: "TEST-TEAM-02",
  },
  {
    id: "TEST-COLLECTOR-04",
    displayName: "测试数采04",
    username: "test-collector-04",
    role: "collector",
    teamId: "TEST-TEAM-02",
  },
];

function validatePasswords(
  passwords: Record<string, string>,
): asserts passwords is Record<TestUsername, string> {
  const expected = [...TEST_IDENTITY_USERNAMES].sort();
  const actual = Object.keys(passwords).sort();
  if (
    expected.length !== actual.length ||
    expected.some((username, index) => username !== actual[index])
  ) {
    throw new Error(
      "EVDP_TEST_ACCOUNT_PASSWORDS_JSON must contain exactly the test usernames",
    );
  }
  for (const username of expected) {
    if (passwords[username]!.length < 8) {
      throw new Error(`Test password for ${username} is too short`);
    }
  }
}

export async function seedIdentity(options: {
  dataSource: DataSource;
  passwords: Record<string, string>;
}): Promise<{
  created: boolean;
  teamsCreated: number;
  accountsCreated: number;
}> {
  validatePasswords(options.passwords);
  if ((await options.dataSource.getRepository(UserEntity).count()) > 0) {
    return { created: false, teamsCreated: 0, accountsCreated: 0 };
  }

  const passwordHashes = Object.fromEntries(
    await Promise.all(
      TEST_IDENTITY_USERNAMES.map(async (username) => {
        const password = options.passwords[username];
        if (!password) {
          throw new Error(`Missing test password for ${username}`);
        }
        return [
          username,
          await argon2.hash(password, {
          type: argon2.argon2id,
          }),
        ];
      }),
    ),
  ) as Record<TestUsername, string>;

  return options.dataSource.transaction(async (manager) => {
    if ((await manager.getRepository(UserEntity).count()) > 0) {
      return { created: false, teamsCreated: 0, accountsCreated: 0 };
    }
    await manager.getRepository(TeamEntity).save([
      {
        id: "TEST-TEAM-01",
        name: "测试团队一",
        status: "active",
        unitPricePerMinute: "10",
      },
      {
        id: "TEST-TEAM-02",
        name: "测试团队二",
        status: "active",
        unitPricePerMinute: "10",
      },
    ]);
    await manager.getRepository(UserEntity).save(
      definitions.map((definition) => ({
        ...definition,
        usernameNormalized: definition.username,
        passwordHash: passwordHashes[definition.username],
        status: "active" as const,
      })),
    );
    return {
      created: true,
      teamsCreated: 2,
      accountsCreated: definitions.length,
    };
  });
}

function parsePasswords(raw: string | undefined): Record<string, string> {
  if (!raw) {
    throw new Error("EVDP_TEST_ACCOUNT_PASSWORDS_JSON is required");
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EVDP_TEST_ACCOUNT_PASSWORDS_JSON must be an object");
  }
  return parsed as Record<string, string>;
}

async function runCli(): Promise<void> {
  const dataSource = createDataSource();
  try {
    await dataSource.initialize();
    const result = await seedIdentity({
      dataSource,
      passwords: parsePasswords(
        process.env.EVDP_TEST_ACCOUNT_PASSWORDS_JSON,
      ),
    });
    console.log(JSON.stringify(result));
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await runCli();
}
