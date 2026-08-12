import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as argon2 from "argon2";
import type { DataSource } from "typeorm";

import { importD1Identity } from "../src/cli/import-d1.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { createDataSource } from "../src/database/data-source.js";
import { SessionEntity } from "../src/database/entities/session.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const LEGACY_PASSWORD = "Legacy-password-2026";

function createD1Fixture(path: string): void {
  execFileSync("sqlite3", [
    path,
    `
      CREATE TABLE accounts (
        id text primary key,
        display_name text not null,
        username text not null,
        username_normalized text not null,
        password_hash text not null,
        role text not null,
        team_id text,
        status text not null,
        created_at integer not null,
        updated_at integer not null
      );
      CREATE TABLE auth_sessions (
        token_hash text primary key,
        account_id text not null,
        created_at integer not null,
        expires_at integer not null
      );
      CREATE TABLE account_audit_logs (
        id text primary key,
        actor_account_id text not null,
        actor_name text not null,
        action text not null,
        target_account_id text not null,
        target_name text not null,
        summary text not null,
        created_at integer not null
      );
      INSERT INTO accounts VALUES
        ('U-ADMIN', '管理员', 'admin', 'admin', '${LEGACY_PASSWORD}', 'admin', NULL, 'active', 1722708000000, 1722708000000),
        ('U-LEADER', '团长', 'leader', 'leader', '${LEGACY_PASSWORD}', 'leader', 'TEAM-01', 'active', 1722708000000, 1722708000000),
        ('U-COLLECTOR', '数采', 'collector', 'collector', '${LEGACY_PASSWORD}', 'collector', 'TEAM-02', 'active', 1722708000000, 1722708000000);
      INSERT INTO auth_sessions VALUES
        ('legacy-session', 'U-ADMIN', 1722708000000, 1822708000000);
      INSERT INTO account_audit_logs VALUES
        ('AUD-LEGACY', 'U-ADMIN', '管理员', 'create', 'U-COLLECTOR', '数采', '创建数采账号', 1722708000000);
    `,
  ]);
}

describe("D1 identity import", () => {
  let dataSource: DataSource;
  let directory: string;
  let d1Path: string;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "evdp-d1-import-"));
    d1Path = join(directory, "fixture.sqlite");
    createD1Fixture(d1Path);
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it("imports accounts, teams and audit without sessions or plaintext passwords", async () => {
    const summary = await importD1Identity({ d1Path, dataSource });

    expect(summary).toEqual({
      teamsCreated: 2,
      accountsCreated: 3,
      auditLogsCreated: 1,
      accountsSkipped: 0,
      auditLogsSkipped: 0,
    });
    expect(await dataSource.getRepository(TeamEntity).count()).toBe(2);
    expect(await dataSource.getRepository(UserEntity).count()).toBe(3);
    expect(await dataSource.getRepository(AuditLogEntity).count()).toBe(1);
    expect(await dataSource.getRepository(SessionEntity).count()).toBe(0);

    const admin = await dataSource.getRepository(UserEntity).findOneByOrFail({
      id: "U-ADMIN",
    });
    expect(admin.passwordHash).not.toBe(LEGACY_PASSWORD);
    expect(await argon2.verify(admin.passwordHash, LEGACY_PASSWORD)).toBe(
      true,
    );
  });

  it("is idempotent", async () => {
    const summary = await importD1Identity({ d1Path, dataSource });

    expect(summary).toMatchObject({
      teamsCreated: 0,
      accountsCreated: 0,
      auditLogsCreated: 0,
      accountsSkipped: 3,
      auditLogsSkipped: 1,
    });
    expect(await dataSource.getRepository(UserEntity).count()).toBe(3);
  });
});
