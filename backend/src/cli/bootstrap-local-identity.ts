import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as argon2 from "argon2";
import { In, type DataSource } from "typeorm";

import { createDataSource } from "../database/data-source.js";
import { TeamEntity } from "../database/entities/team.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";

export const LOCAL_STARTER_ACCOUNTS = [
  { id: "U-ADMIN-01", username: "admin", displayName: "管理员", role: "admin", teamId: null, password: "admin123" },
  { id: "U-LEAD-01", username: "tuanzhang1", displayName: "团长1", role: "leader", teamId: "TEAM-01", password: "team1234" },
  { id: "U-LEAD-02", username: "tuanzhang2", displayName: "团长2", role: "leader", teamId: "TEAM-02", password: "team1234" },
  { id: "U-COL-01", username: "ceshirenyuan1", displayName: "数采人员1", role: "collector", teamId: "TEAM-01", password: "user1234" },
  { id: "U-COL-02", username: "ceshirenyuan2", displayName: "数采人员2", role: "collector", teamId: "TEAM-01", password: "user1234" },
  { id: "U-COL-03", username: "ceshirenyuan3", displayName: "数采人员3", role: "collector", teamId: "TEAM-01", password: "user1234" },
  { id: "U-COL-04", username: "ceshirenyuan4", displayName: "数采人员4", role: "collector", teamId: "TEAM-02", password: "user1234" },
  { id: "U-COL-05", username: "ceshirenyuan5", displayName: "数采人员5", role: "collector", teamId: "TEAM-02", password: "user1234" },
] as const;

const LOCAL_STARTER_TEAMS = [
  { id: "TEAM-01", name: "团队1" },
  { id: "TEAM-02", name: "团队2" },
] as const;

export type LocalIdentityBootstrapResult = {
  applied: boolean;
  teamsCreated: number;
  accountsCreated: number;
};

export async function bootstrapLocalIdentity(options: {
  dataSource: DataSource;
  mode: "create-if-empty";
}): Promise<LocalIdentityBootstrapResult> {
  return options.dataSource.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock($1)", [390032102]);

    if ((await manager.getRepository(UserEntity).count()) > 0) {
      return { applied: false, teamsCreated: 0, accountsCreated: 0 };
    }

    const teamRepository = manager.getRepository(TeamEntity);
    const existingTeams = await teamRepository.findBy({
      id: In(LOCAL_STARTER_TEAMS.map((team) => team.id)),
    });
    const existingTeamIds = new Set(existingTeams.map((team) => team.id));
    const missingTeams = LOCAL_STARTER_TEAMS.filter(
      (team) => !existingTeamIds.has(team.id),
    );
    await teamRepository.save(
      missingTeams.map((team) => ({
        ...team,
        status: "active" as const,
        unitPricePerMinute: "0",
      })),
    );

    const passwordHashes = await Promise.all(
      LOCAL_STARTER_ACCOUNTS.map(async (account) =>
        argon2.hash(account.password, { type: argon2.argon2id }),
      ),
    );
    await manager.getRepository(UserEntity).save(
      LOCAL_STARTER_ACCOUNTS.map((account, index) => ({
        id: account.id,
        username: account.username,
        usernameNormalized: account.username,
        displayName: account.displayName,
        role: account.role,
        teamId: account.teamId,
        passwordHash: passwordHashes[index]!,
        status: "active" as const,
      })),
    );

    return {
      applied: true,
      teamsCreated: missingTeams.length,
      accountsCreated: LOCAL_STARTER_ACCOUNTS.length,
    };
  });
}

async function runCli(): Promise<void> {
  const dataSource = createDataSource();
  try {
    await dataSource.initialize();
    const result = await bootstrapLocalIdentity({
      dataSource,
      mode: "create-if-empty",
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
