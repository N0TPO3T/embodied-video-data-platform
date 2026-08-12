import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import request from "supertest";
import type { DataSource } from "typeorm";

import { AuthModule } from "../src/auth/auth.module.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import {
  createDataSource,
  identityEntities,
} from "../src/database/data-source.js";
import { SessionEntity } from "../src/database/entities/session.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { configureApplication } from "../src/http/configure-application.js";
import { IdentityModule } from "../src/identity/identity.module.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Valid-test-password-2026";
const NEW_PASSWORD = "Changed-test-password-2026";

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("account and team API", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let passwordHash: string;

  async function login(username: string, password = TEST_PASSWORD) {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ username, password })
      .expect(200);
    return cookieFrom(response);
  }

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    passwordHash = await argon2.hash(TEST_PASSWORD, {
      type: argon2.argon2id,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          url: TEST_DATABASE_URL,
          entities: identityEntities,
          synchronize: false,
        }),
        AuthModule,
        IdentityModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app, WEB_ORIGIN);
    await app.init();
  });

  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE sessions, audit_logs, users, teams RESTART IDENTITY CASCADE",
    );
    await dataSource.getRepository(TeamEntity).save([
      { id: "TEAM-01", name: "测试一队" },
      { id: "TEAM-02", name: "测试二队" },
    ]);
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-ADMIN",
        displayName: "管理员",
        username: "admin",
        usernameNormalized: "admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-LEADER",
        displayName: "一队团长",
        username: "leader",
        usernameNormalized: "leader",
        passwordHash,
        role: "leader",
        teamId: "TEAM-01",
        status: "active",
      },
      {
        id: "U-OTHER",
        displayName: "二队数采",
        username: "other",
        usernameNormalized: "other",
        passwordHash,
        role: "collector",
        teamId: "TEAM-02",
        status: "active",
      },
    ]);
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("lets an administrator create every role and writes audit", async () => {
    const cookie = await login("admin");
    const response = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        displayName: "二队团长",
        username: "leader-two",
        password: TEST_PASSWORD,
        role: "leader",
        teamId: "TEAM-02",
      })
      .expect(201);

    expect(response.body.account).toMatchObject({
      displayName: "二队团长",
      username: "leader-two",
      role: "leader",
      teamId: "TEAM-02",
      status: "active",
    });
    const log = await dataSource.getRepository(AuditLogEntity).findOneByOrFail({
      targetAccountId: response.body.account.id,
    });
    expect(log.action).toBe("create");
    expect(log.actorAccountId).toBe("U-ADMIN");
  });

  it("accepts 8 and 64 character account passwords but rejects 65 characters", async () => {
    const cookie = await login("admin");
    const password8 = "12345678";
    const password64 = "a".repeat(64);
    const password65 = "b".repeat(65);

    const minimum = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        displayName: "最短密码账号",
        username: "password-minimum",
        password: password8,
        role: "collector",
        teamId: "TEAM-01",
      })
      .expect(201);
    const maximum = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        displayName: "最长密码账号",
        username: "password-maximum",
        password: password64,
        role: "collector",
        teamId: "TEAM-01",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        displayName: "超长密码账号",
        username: "password-too-long",
        password: password65,
        role: "collector",
        teamId: "TEAM-01",
      })
      .expect(400);

    const users = dataSource.getRepository(UserEntity);
    expect(
      await argon2.verify(
        (await users.findOneByOrFail({ id: minimum.body.account.id }))
          .passwordHash,
        password8,
      ),
    ).toBe(true);
    expect(
      await argon2.verify(
        (await users.findOneByOrFail({ id: maximum.body.account.id }))
          .passwordHash,
        password64,
      ),
    ).toBe(true);
    expect(
      await users.findOneBy({ usernameNormalized: "password-too-long" }),
    ).toBeNull();
  });

  it("accepts 8 and 64 character reset passwords but rejects 65 characters", async () => {
    const cookie = await login("admin");
    const password8 = "87654321";
    const password64 = "c".repeat(64);
    const password65 = "d".repeat(65);

    await request(app.getHttpServer())
      .post("/api/v1/accounts/U-OTHER/reset-password")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({ password: password8 })
      .expect(201);
    let target = await dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ id: "U-OTHER" });
    expect(await argon2.verify(target.passwordHash, password8)).toBe(true);

    await request(app.getHttpServer())
      .post("/api/v1/accounts/U-OTHER/reset-password")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({ password: password64 })
      .expect(201);
    target = await dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ id: "U-OTHER" });
    expect(await argon2.verify(target.passwordHash, password64)).toBe(true);

    await request(app.getHttpServer())
      .post("/api/v1/accounts/U-OTHER/reset-password")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({ password: password65 })
      .expect(400);
    target = await dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ id: "U-OTHER" });
    expect(await argon2.verify(target.passwordHash, password64)).toBe(true);
  });

  it("limits a leader to visible own-team collectors", async () => {
    const cookie = await login("leader");
    const list = await request(app.getHttpServer())
      .get("/api/v1/accounts")
      .set("Cookie", cookie)
      .expect(200);
    expect(
      list.body.accounts.every(
        (account: { teamId?: string }) => account.teamId === "TEAM-01",
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        displayName: "一队新数采",
        username: "own-collector",
        password: TEST_PASSWORD,
        role: "collector",
        teamId: "TEAM-01",
      })
      .expect(201);

    const forbidden = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        displayName: "越权数采",
        username: "cross-team",
        password: TEST_PASSWORD,
        role: "collector",
        teamId: "TEAM-02",
      })
      .expect(403);
    expect(forbidden.body.code).toBe("FORBIDDEN");
  });

  it("rejects a case-insensitive duplicate username", async () => {
    const cookie = await login("admin");
    const response = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        displayName: "重复管理员",
        username: "ADMIN",
        password: TEST_PASSWORD,
        role: "admin",
      })
      .expect(409);
    expect(response.body.code).toBe("CONFLICT");
  });

  it("protects the last active administrator", async () => {
    const cookie = await login("admin");
    const response = await request(app.getHttpServer())
      .patch("/api/v1/accounts/U-ADMIN/status")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({ status: "disabled" })
      .expect(400);
    expect(response.body.code).toBe("VALIDATION");
  });

  it("keeps an active administrator when two administrators concurrently remove each other", async () => {
    await dataSource.getRepository(UserEntity).save({
      id: "U-ADMIN-2",
      displayName: "第二管理员",
      username: "admin-two",
      usernameNormalized: "admin-two",
      passwordHash,
      role: "admin",
      teamId: null,
      status: "active",
    });
    const firstCookie = await login("admin");
    const secondCookie = await login("admin-two");

    await dataSource.query(`
      CREATE OR REPLACE FUNCTION test_delay_active_admin_removal()
      RETURNS trigger AS $$
      BEGIN
        IF OLD.role = 'admin' AND OLD.status = 'active'
          AND (NEW.role <> 'admin' OR NEW.status <> 'active') THEN
          PERFORM pg_sleep(0.5);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await dataSource.query(`
      CREATE TRIGGER test_delay_active_admin_removal_trigger
      BEFORE UPDATE OF role, status ON users
      FOR EACH ROW EXECUTE FUNCTION test_delay_active_admin_removal()
    `);

    try {
      const [disableSecond, demoteFirst] = await Promise.all([
        request(app.getHttpServer())
          .patch("/api/v1/accounts/U-ADMIN-2/status")
          .set("Origin", WEB_ORIGIN)
          .set("Cookie", firstCookie)
          .send({ status: "disabled" }),
        request(app.getHttpServer())
          .patch("/api/v1/accounts/U-ADMIN")
          .set("Origin", WEB_ORIGIN)
          .set("Cookie", secondCookie)
          .send({
            displayName: "管理员",
            username: "admin",
            role: "leader",
            teamId: "TEAM-01",
          }),
      ]);

      expect([disableSecond.status, demoteFirst.status].sort()).toEqual([
        200,
        400,
      ]);
      expect(
        await dataSource.getRepository(UserEntity).countBy({
          role: "admin",
          status: "active",
        }),
      ).toBe(1);
      const rejected =
        disableSecond.status === 400 ? disableSecond : demoteFirst;
      expect(rejected.body.code).toBe("VALIDATION");
    } finally {
      await dataSource.query(
        "DROP TRIGGER IF EXISTS test_delay_active_admin_removal_trigger ON users",
      );
      await dataSource.query(
        "DROP FUNCTION IF EXISTS test_delay_active_admin_removal()",
      );
    }
  });

  it("revokes sessions when a leader disables an own-team collector", async () => {
    const leaderCookie = await login("leader");
    const created = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", leaderCookie)
      .send({
        displayName: "待停用数采",
        username: "disabled-later",
        password: TEST_PASSWORD,
        role: "collector",
        teamId: "TEAM-01",
      })
      .expect(201);
    const collectorCookie = await login("disabled-later");

    await request(app.getHttpServer())
      .patch(`/api/v1/accounts/${created.body.account.id}/status`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", leaderCookie)
      .send({ status: "disabled" })
      .expect(200);

    await request(app.getHttpServer())
      .get("/api/v1/auth/session")
      .set("Cookie", collectorCookie)
      .expect(401);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "disable",
      }),
    ).toBe(1);
  });

  it("requires an authenticated session and allowed origin to change the current account password", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/accounts/me/change-password")
      .set("Origin", WEB_ORIGIN)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      })
      .expect(401);

    const cookie = await login("admin");
    await request(app.getHttpServer())
      .post("/api/v1/accounts/me/change-password")
      .set("Origin", "http://untrusted.example")
      .set("Cookie", cookie)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      })
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/v1/accounts/U-OTHER/change-password")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      })
      .expect(404);
  });

  it("requires both passwords to be between 8 and 64 characters", async () => {
    const cookie = await login("admin");
    await request(app.getHttpServer())
      .post("/api/v1/accounts/me/change-password")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({ currentPassword: TEST_PASSWORD, newPassword: "short" })
      .expect(400);
  });

  it("rejects a wrong current password without changing the account", async () => {
    const cookie = await login("admin");
    const response = await request(app.getHttpServer())
      .post("/api/v1/accounts/me/change-password")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        currentPassword: "Wrong-test-password-2026",
        newPassword: NEW_PASSWORD,
      })
      .expect(400);

    expect(response.body.code).toBe("VALIDATION");
    const account = await dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ id: "U-ADMIN" });
    expect(await argon2.verify(account.passwordHash, TEST_PASSWORD)).toBe(
      true,
    );
    expect(await argon2.verify(account.passwordHash, NEW_PASSWORD)).toBe(
      false,
    );
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "change_password",
      }),
    ).toBe(0);
  });

  it("changes its own password, revokes every session, clears the cookie, and writes a sanitized audit", async () => {
    const firstCookie = await login("admin");
    const secondCookie = await login("admin");

    const response = await request(app.getHttpServer())
      .post("/api/v1/accounts/me/change-password")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", firstCookie)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      })
      .expect(204);

    expect(response.headers["set-cookie"]?.[0]).toContain("evdp_session=;");
    const account = await dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ id: "U-ADMIN" });
    expect(await argon2.verify(account.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(await argon2.verify(account.passwordHash, TEST_PASSWORD)).toBe(
      false,
    );
    expect(account.failedAttemptCount).toBe(0);
    expect(account.firstFailedAt).toBeNull();
    expect(account.lockedUntil).toBeNull();
    expect(
      await dataSource.getRepository(SessionEntity).countBy({
        accountId: "U-ADMIN",
      }),
    ).toBe(0);

    await request(app.getHttpServer())
      .get("/api/v1/auth/session")
      .set("Cookie", firstCookie)
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/v1/auth/session")
      .set("Cookie", secondCookie)
      .expect(401);

    const audit = await dataSource.getRepository(AuditLogEntity).findOneByOrFail({
      action: "change_password",
    });
    expect(audit).toMatchObject({
      actorAccountId: "U-ADMIN",
      targetAccountId: "U-ADMIN",
      beforeValue: null,
      afterValue: null,
    });
    expect(JSON.stringify(audit)).not.toContain(TEST_PASSWORD);
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
  });

  it("reserves team creation for administrators", async () => {
    const adminCookie = await login("admin");
    await request(app.getHttpServer())
      .post("/api/v1/teams")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ name: "新测试团队", unitPricePerMinute: 10 })
      .expect(201);

    const leaderCookie = await login("leader");
    await request(app.getHttpServer())
      .post("/api/v1/teams")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", leaderCookie)
      .send({ name: "越权团队", unitPricePerMinute: 10 })
      .expect(403);
  });
});
