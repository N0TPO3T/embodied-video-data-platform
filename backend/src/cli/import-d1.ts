import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import * as argon2 from "argon2";
import type { DataSource } from "typeorm";

import { AuditLogEntity } from "../database/entities/audit-log.entity.js";
import { createDataSource } from "../database/data-source.js";
import { TeamEntity } from "../database/entities/team.entity.js";
import {
  UserEntity,
  type UserRole,
  type UserStatus,
} from "../database/entities/user.entity.js";

const execFileAsync = promisify(execFile);

type D1Account = {
  id: string;
  display_name: string;
  username: string;
  username_normalized: string;
  password_hash: string;
  role: UserRole;
  team_id: string | null;
  status: UserStatus;
  created_at: number;
  updated_at: number;
};

type D1AuditLog = {
  id: string;
  actor_account_id: string;
  actor_name: string;
  action: string;
  target_account_id: string;
  target_name: string;
  summary: string;
  created_at: number;
};

export type D1ImportSummary = {
  teamsCreated: number;
  accountsCreated: number;
  auditLogsCreated: number;
  accountsSkipped: number;
  auditLogsSkipped: number;
};

async function sqliteJson<T>(path: string, query: string): Promise<T[]> {
  const { stdout } = await execFileAsync(
    "sqlite3",
    ["-readonly", "-json", path, query],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const text = stdout.trim();
  return text ? (JSON.parse(text) as T[]) : [];
}

function validateAccount(account: D1Account): void {
  if (!["admin", "leader", "collector"].includes(account.role)) {
    throw new Error(`D1 account ${account.id} has an invalid role`);
  }
  if (!["active", "disabled"].includes(account.status)) {
    throw new Error(`D1 account ${account.id} has an invalid status`);
  }
  if (account.role !== "admin" && !account.team_id) {
    throw new Error(`D1 account ${account.id} has no team`);
  }
}

export async function importD1Identity(options: {
  d1Path: string;
  dataSource: DataSource;
}): Promise<D1ImportSummary> {
  await access(options.d1Path);
  const accounts = await sqliteJson<D1Account>(
    options.d1Path,
    `SELECT
      id, display_name, username, username_normalized, password_hash,
      role, team_id, status, created_at, updated_at
    FROM accounts
    ORDER BY created_at, id`,
  );
  const auditLogs = await sqliteJson<D1AuditLog>(
    options.d1Path,
    `SELECT
      id, actor_account_id, actor_name, action, target_account_id,
      target_name, summary, created_at
    FROM account_audit_logs
    ORDER BY created_at, id`,
  );
  accounts.forEach(validateAccount);

  return options.dataSource.transaction(async (manager) => {
    const teams = manager.getRepository(TeamEntity);
    const users = manager.getRepository(UserEntity);
    const audit = manager.getRepository(AuditLogEntity);
    const summary: D1ImportSummary = {
      teamsCreated: 0,
      accountsCreated: 0,
      auditLogsCreated: 0,
      accountsSkipped: 0,
      auditLogsSkipped: 0,
    };

    const teamIds = [
      ...new Set(
        accounts
          .map((account) => account.team_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    for (const id of teamIds) {
      if (await teams.findOneBy({ id })) continue;
      await teams.save({
        id,
        name: `迁移团队 ${id}`,
        status: "active",
        unitPricePerMinute: "0",
      });
      summary.teamsCreated += 1;
    }

    for (const account of accounts) {
      if (await users.findOneBy({ id: account.id })) {
        summary.accountsSkipped += 1;
        continue;
      }
      const passwordHash = await argon2.hash(account.password_hash, {
        type: argon2.argon2id,
      });
      await users.save({
        id: account.id,
        displayName: account.display_name,
        username: account.username,
        usernameNormalized: account.username_normalized,
        passwordHash,
        role: account.role,
        teamId: account.team_id,
        status: account.status,
        createdAt: new Date(account.created_at),
        updatedAt: new Date(account.updated_at),
      });
      summary.accountsCreated += 1;
    }

    for (const source of auditLogs) {
      if (await audit.findOneBy({ id: source.id })) {
        summary.auditLogsSkipped += 1;
        continue;
      }
      await audit.save({
        id: source.id,
        actorAccountId: source.actor_account_id,
        actorName: source.actor_name,
        action: source.action,
        targetAccountId: source.target_account_id,
        targetName: source.target_name,
        summary: source.summary,
        createdAt: new Date(source.created_at),
      });
      summary.auditLogsCreated += 1;
    }

    return summary;
  });
}

async function runCli(): Promise<void> {
  const d1Path = process.env.D1_SQLITE_PATH;
  if (!d1Path) throw new Error("D1_SQLITE_PATH is required");
  const dataSource = createDataSource();
  try {
    await dataSource.initialize();
    const summary = await importD1Identity({ d1Path, dataSource });
    console.log(JSON.stringify(summary));
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
