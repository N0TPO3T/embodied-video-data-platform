import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import request from "supertest";
import type { DataSource } from "typeorm";

import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import {
  createDataSource,
  identityEntities,
} from "../src/database/data-source.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { AuthModule } from "../src/auth/auth.module.js";
import { configureApplication } from "../src/http/configure-application.js";
import { IdentityModule } from "../src/identity/identity.module.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Phase-one-smoke-password-2026";

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("phase one identity cutover smoke", () => {
  let app: INestApplication;
  let dataSource: DataSource;

  async function login(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ username, password: TEST_PASSWORD })
      .expect(200);
    return cookieFrom(response);
  }

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();

    const passwordHash = await argon2.hash(TEST_PASSWORD, {
      type: argon2.argon2id,
    });
    await dataSource.getRepository(TeamEntity).save([
      { id: "TEAM-SMOKE-01", name: "冒烟测试一队" },
      { id: "TEAM-SMOKE-02", name: "冒烟测试二队" },
    ]);
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-SMOKE-ADMIN",
        displayName: "冒烟测试管理员",
        username: "smoke-admin",
        usernameNormalized: "smoke-admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-SMOKE-LEADER",
        displayName: "冒烟测试团长",
        username: "smoke-leader",
        usernameNormalized: "smoke-leader",
        passwordHash,
        role: "leader",
        teamId: "TEAM-SMOKE-01",
        status: "active",
      },
    ]);

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

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("covers login, visibility, own-team writes, revocation, and audit", async () => {
    const adminCookie = await login("smoke-admin");
    const adminList = await request(app.getHttpServer())
      .get("/api/v1/accounts")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(adminList.body.accounts).toHaveLength(2);

    const leaderCookie = await login("smoke-leader");
    const created = await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", leaderCookie)
      .send({
        displayName: "冒烟测试数采",
        username: "smoke-collector",
        password: TEST_PASSWORD,
        role: "collector",
        teamId: "TEAM-SMOKE-01",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/v1/accounts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", leaderCookie)
      .send({
        displayName: "越权数采",
        username: "smoke-cross-team",
        password: TEST_PASSWORD,
        role: "collector",
        teamId: "TEAM-SMOKE-02",
      })
      .expect(403);

    const collectorCookie = await login("smoke-collector");
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

    const logs = await dataSource
      .getRepository(AuditLogEntity)
      .find({ order: { createdAt: "ASC" } });
    expect(logs.map((log) => log.action)).toEqual([
      "create",
      "disable",
    ]);
    expect(logs.every((log) => log.actorAccountId === "U-SMOKE-LEADER"))
      .toBe(true);
  });
});
