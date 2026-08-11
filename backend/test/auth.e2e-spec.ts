import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import request from "supertest";
import type { DataSource } from "typeorm";

import { AuthModule } from "../src/auth/auth.module.js";
import { configureApplication } from "../src/http/configure-application.js";
import {
  createDataSource,
  identityEntities,
} from "../src/database/data-source.js";
import { SessionEntity } from "../src/database/entities/session.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Valid-test-password-2026";

function sessionCookie(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("authentication API", () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();

    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          url: TEST_DATABASE_URL,
          entities: identityEntities,
          synchronize: false,
        }),
        AuthModule,
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
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-01",
      name: "测试团队",
    });
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-ADMIN",
        displayName: "管理员",
        username: "Admin",
        usernameNormalized: "admin",
        passwordHash: await argon2.hash(TEST_PASSWORD, {
          type: argon2.argon2id,
        }),
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-DISABLED",
        displayName: "停用账号",
        username: "disabled",
        usernameNormalized: "disabled",
        passwordHash: await argon2.hash(TEST_PASSWORD, {
          type: argon2.argon2id,
        }),
        role: "collector",
        teamId: "TEAM-01",
        status: "disabled",
      },
    ]);
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("logs in with a normalized username and returns a revocable session", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ username: "  ADMIN ", password: TEST_PASSWORD })
      .expect(200);

    expect(login.body).toMatchObject({
      user: {
        id: "U-ADMIN",
        displayName: "管理员",
        username: "Admin",
        role: "admin",
        status: "active",
      },
      homePath: "/admin",
    });
    expect(login.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");
    expect(login.headers["set-cookie"]?.[0]).not.toContain("Secure");

    const cookie = sessionCookie(login);
    const current = await request(app.getHttpServer())
      .get("/api/v1/auth/session")
      .set("Cookie", cookie)
      .expect(200);
    expect(current.body.user.id).toBe("U-ADMIN");

    await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .expect(204);
    await request(app.getHttpServer())
      .get("/api/v1/auth/session")
      .set("Cookie", cookie)
      .expect(401);
  });

  it("uses the same error for an unknown account and a bad password", async () => {
    const unknown = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ username: "missing", password: TEST_PASSWORD })
      .expect(401);
    const incorrect = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ username: "admin", password: "Wrong-password-2026" })
      .expect(401);

    expect(unknown.body).toEqual(incorrect.body);
    expect(unknown.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a disabled account before creating a session", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ username: "disabled", password: TEST_PASSWORD })
      .expect(403);

    expect(response.body.code).toBe("DISABLED");
    expect(await dataSource.getRepository(SessionEntity).count()).toBe(0);
  });

  it("locks an account after five failed attempts", async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .set("Origin", WEB_ORIGIN)
        .send({ username: "admin", password: "Wrong-password-2026" })
        .expect(401);
    }
    const locked = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ username: "admin", password: "Wrong-password-2026" })
      .expect(429);

    expect(locked.body.code).toBe("LOCKED");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
  });
});
