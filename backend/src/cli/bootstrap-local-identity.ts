import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as argon2 from "argon2";
import { In, type DataSource } from "typeorm";

import { createDataSource } from "../database/data-source.js";
import { AuditLogEntity } from "../database/entities/audit-log.entity.js";
import { SessionEntity } from "../database/entities/session.entity.js";
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

export const ALLOW_LOCAL_DEFAULT_PASSWORDS_ENV =
  "EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS";

const LOCAL_STARTER_TEAMS = [
  { id: "TEAM-01", name: "团队1" },
  { id: "TEAM-02", name: "团队2" },
] as const;

export type LocalIdentityBootstrapResult = {
  applied: boolean;
  teamsCreated: number;
  accountsCreated: number;
};

export type LocalIdentityReconcileResult = LocalIdentityBootstrapResult & {
  accountsUpdated: number;
};

function sanitizedIdentity(user: UserEntity): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    teamId: user.teamId,
    status: user.status,
  };
}

async function verifiesApprovedPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function assertLocalDefaultPasswordsAllowed(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (
    environment.NODE_ENV === "production" &&
    environment[ALLOW_LOCAL_DEFAULT_PASSWORDS_ENV] !== "true"
  ) {
    throw new Error(
      `${ALLOW_LOCAL_DEFAULT_PASSWORDS_ENV}=true is required before local starter accounts with default passwords can be created in production mode`,
    );
  }
}

export async function bootstrapLocalIdentity(options: {
  dataSource: DataSource;
  mode: "create-if-empty" | "reconcile";
}): Promise<LocalIdentityBootstrapResult | LocalIdentityReconcileResult> {
  assertLocalDefaultPasswordsAllowed();
  return options.dataSource.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock($1)", [390032102]);

    const users = manager.getRepository(UserEntity);
    if (
      options.mode === "create-if-empty" &&
      (await users.count()) > 0
    ) {
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

    if (options.mode === "reconcile") {
      const sessions = manager.getRepository(SessionEntity);
      const audits = manager.getRepository(AuditLogEntity);
      let accountsCreated = 0;
      let accountsUpdated = 0;

      for (const starter of LOCAL_STARTER_ACCOUNTS) {
        const existing = await users.findOneBy({
          usernameNormalized: starter.username,
        });
        if (!existing) {
          const passwordHash = await argon2.hash(starter.password, {
            type: argon2.argon2id,
          });
          const accountId = await users.findOneBy({ id: starter.id })
            ? `U-${randomUUID()}`
            : starter.id;
          const created = await users.save({
            id: accountId,
            username: starter.username,
            usernameNormalized: starter.username,
            displayName: starter.displayName,
            role: starter.role,
            teamId: starter.teamId,
            passwordHash,
            status: "active",
            failedAttemptCount: 0,
            firstFailedAt: null,
            lockedUntil: null,
          });
          await audits.save({
            id: `AUD-${randomUUID()}`,
            actorAccountId: "system",
            actorName: "system",
            action: "local_identity_reconcile",
            targetAccountId: created.id,
            targetName: created.displayName,
            summary: "本地身份校准",
            beforeValue: null,
            afterValue: sanitizedIdentity(created),
          });
          accountsCreated += 1;
          continue;
        }

        const before = sanitizedIdentity(existing);
        const identityChanged =
          existing.username !== starter.username ||
          existing.usernameNormalized !== starter.username ||
          existing.displayName !== starter.displayName ||
          existing.role !== starter.role ||
          existing.teamId !== starter.teamId ||
          existing.status !== "active";
        const passwordChanged = !(await verifiesApprovedPassword(
          existing.passwordHash,
          starter.password,
        ));
        const failedLoginStateChanged =
          existing.failedAttemptCount !== 0 ||
          existing.firstFailedAt !== null ||
          existing.lockedUntil !== null;

        if (!identityChanged && !passwordChanged && !failedLoginStateChanged) {
          continue;
        }

        existing.username = starter.username;
        existing.usernameNormalized = starter.username;
        existing.displayName = starter.displayName;
        existing.role = starter.role;
        existing.teamId = starter.teamId;
        existing.status = "active";
        existing.failedAttemptCount = 0;
        existing.firstFailedAt = null;
        existing.lockedUntil = null;
        if (passwordChanged) {
          existing.passwordHash = await argon2.hash(starter.password, {
            type: argon2.argon2id,
          });
        }
        const saved = await users.save(existing);
        await sessions.delete({ accountId: saved.id });
        await audits.save({
          id: `AUD-${randomUUID()}`,
          actorAccountId: "system",
          actorName: "system",
          action: "local_identity_reconcile",
          targetAccountId: saved.id,
          targetName: saved.displayName,
          summary: "本地身份校准",
          beforeValue: before,
          afterValue: sanitizedIdentity(saved),
        });
        accountsUpdated += 1;
      }

      return {
        applied: missingTeams.length > 0 || accountsCreated > 0 || accountsUpdated > 0,
        teamsCreated: missingTeams.length,
        accountsCreated,
        accountsUpdated,
      };
    }

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
      mode: process.argv.includes("--reconcile")
        ? "reconcile"
        : "create-if-empty",
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
