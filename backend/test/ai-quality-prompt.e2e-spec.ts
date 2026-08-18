import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import request from "supertest";
import type { DataSource } from "typeorm";

import { AiQualityModule } from "../src/ai-quality/ai-quality.module.js";
import { AuthModule } from "../src/auth/auth.module.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { createDataSource, identityEntities } from "../src/database/data-source.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { LabelSetVersionEntity } from "../src/database/entities/label-set-version.entity.js";
import { QualityRuleVersionEntity } from "../src/database/entities/quality-rule-version.entity.js";
import { VideoQualityPromptVersionEntity } from "../src/database/entities/video-quality-prompt-version.entity.js";
import { configureApplication } from "../src/http/configure-application.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const PASSWORD = "Valid-test-password-2026";
const PROMPT_PATH = fileURLToPath(
  new URL(
    "../../docs/quality/prompts/qwen-video-ai-quality-prompt-v1/manifest.json",
    import.meta.url,
  ),
);
const SYSTEM_PROMPT_PATH = fileURLToPath(
  new URL(
    "../../docs/quality/prompts/qwen-video-ai-quality-prompt-v1/system.txt",
    import.meta.url,
  ),
);

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("AI quality prompt API", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminCookie: string;
  let collectorCookie: string;

  beforeAll(async () => {
    process.env.VIDEO_QUALITY_PROMPT_PATH = PROMPT_PATH;
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-PROMPT",
      name: "提示词测试团队",
    });
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-PROMPT-ADMIN",
        displayName: "提示词管理员",
        username: "prompt-admin",
        usernameNormalized: "prompt-admin",
        passwordHash,
        role: "admin",
        status: "active",
      },
      {
        id: "U-PROMPT-COLLECTOR",
        displayName: "提示词数采",
        username: "prompt-collector",
        usernameNormalized: "prompt-collector",
        passwordHash,
        role: "collector",
        teamId: "TEAM-PROMPT",
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
        AiQualityModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app, WEB_ORIGIN);
    await app.init();
    for (const [username, assign] of [
      ["prompt-admin", (value: string) => (adminCookie = value)],
      ["prompt-collector", (value: string) => (collectorCookie = value)],
    ] as const) {
      const login = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .set("Origin", WEB_ORIGIN)
        .send({ username, password: PASSWORD })
        .expect(200);
      assign(cookieFrom(login));
    }
  });

  afterAll(async () => {
    delete process.env.VIDEO_QUALITY_PROMPT_PATH;
    await app?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("imports the committed Qwen3.7 prompt exactly once and returns it only to admins", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/ai-quality/prompt")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body.prompt).toMatchObject({
      revision: 1,
      promptVersion: "qwen_video_qc_prompt_v2",
      ruleVersion: "video_qc_v1",
      outputSchema: "video_qc_v1",
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      createdByName: "系统初始化",
    });
    expect(response.body.prompt.systemPrompt).toContain("具身视频数据质量评估器");
    expect(await dataSource.getRepository(VideoQualityPromptVersionEntity).count()).toBe(1);

    await request(app.getHttpServer())
      .get("/api/v1/ai-quality/prompt")
      .set("Cookie", collectorCookie)
      .expect(403);
  });

  it("creates a new active revision without writing the full prompt into audit", async () => {
    const original = await readFile(SYSTEM_PROMPT_PATH, "utf8");
    const systemPrompt = `${original.slice(0, 2000)}\n管理员补充：优先检查手部与对象完整性。`;
    const response = await request(app.getHttpServer())
      .put("/api/v1/ai-quality/prompt")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ systemPrompt })
      .expect(200);

    expect(response.body.prompt).toMatchObject({
      revision: 2,
      systemPrompt,
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      createdByName: "提示词管理员",
    });
    const prompts = await dataSource.getRepository(VideoQualityPromptVersionEntity).find({
      order: { revision: "ASC" },
    });
    expect(prompts.map((item) => item.active)).toEqual([false, true]);

    const audit = await dataSource.getRepository(AuditLogEntity).findOneByOrFail({
      action: "ai_quality_prompt_update",
    });
    expect(audit.summary).toContain("版本 2");
    expect(JSON.stringify(audit)).not.toContain(systemPrompt);
  });

  it("publishes active quality rule versions and audits the change", async () => {
    const initial = await request(app.getHttpServer())
      .get("/api/v1/ai-quality/quality-rule")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(initial.body.rule).toMatchObject({
      revision: 1,
      version: "RULE-2026-08",
      passThreshold: 60,
      description: "八月具身视频质量准入规则",
      createdByName: "系统初始化",
    });

    const published = await request(app.getHttpServer())
      .put("/api/v1/ai-quality/quality-rule")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        version: "RULE-2026-09",
        passThreshold: 65,
        description: "九月质量规则",
      })
      .expect(200);
    expect(published.body.rule).toMatchObject({
      revision: 2,
      version: "RULE-2026-09",
      passThreshold: 65,
      description: "九月质量规则",
      createdByName: "提示词管理员",
    });

    const rules = await dataSource
      .getRepository(QualityRuleVersionEntity)
      .find({ order: { revision: "ASC" } });
    expect(rules.map((rule) => rule.active)).toEqual([false, true]);

    const audit = await dataSource.getRepository(AuditLogEntity).findOneByOrFail({
      action: "quality_rule_publish",
    });
    expect(audit.summary).toContain("RULE-2026-09");

    await request(app.getHttpServer())
      .get("/api/v1/ai-quality/quality-rule")
      .set("Cookie", collectorCookie)
      .expect(403);
    await request(app.getHttpServer())
      .put("/api/v1/ai-quality/quality-rule")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({
        version: "RULE-2026-10",
        passThreshold: 70,
        description: "无权限规则",
      })
      .expect(403);
  });

  it("versions label set updates and audits the changed label", async () => {
    const initial = await request(app.getHttpServer())
      .get("/api/v1/ai-quality/label-set")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(initial.body.labelSet).toMatchObject({
      revision: 1,
      version: "LABELS-2026-08",
      createdByName: "系统初始化",
    });
    expect(initial.body.labelSet.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "SCENE-001",
          name: "家庭厨房",
          enabled: true,
        }),
      ]),
    );

    const updated = await request(app.getHttpServer())
      .put("/api/v1/ai-quality/labels/SCENE-001")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        id: "IGNORED-BODY-ID",
        name: "家庭烹饪",
        enabled: false,
      })
      .expect(200);
    expect(updated.body.labelSet).toMatchObject({
      revision: 2,
      createdByName: "提示词管理员",
    });
    expect(updated.body.labelSet.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "SCENE-001",
          name: "家庭烹饪",
          enabled: false,
        }),
      ]),
    );

    const labelSets = await dataSource
      .getRepository(LabelSetVersionEntity)
      .find({ order: { revision: "ASC" } });
    expect(labelSets.map((item) => item.active)).toEqual([false, true]);

    const audit = await dataSource.getRepository(AuditLogEntity).findOneByOrFail({
      action: "label_set_update",
    });
    expect(audit.summary).toContain("家庭烹饪");

    await request(app.getHttpServer())
      .get("/api/v1/ai-quality/label-set")
      .set("Cookie", collectorCookie)
      .expect(403);
  });

  it("rejects non-admin writes, invalid origins and empty prompts", async () => {
    await request(app.getHttpServer())
      .put("/api/v1/ai-quality/prompt")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ systemPrompt: "有效但无权限的提示词" })
      .expect(403);
    await request(app.getHttpServer())
      .put("/api/v1/ai-quality/prompt")
      .set("Origin", "https://evil.example")
      .set("Cookie", adminCookie)
      .send({ systemPrompt: "有效但来源错误的提示词" })
      .expect(403);
    await request(app.getHttpServer())
      .put("/api/v1/ai-quality/prompt")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ systemPrompt: "   " })
      .expect(400);
    await request(app.getHttpServer())
      .put("/api/v1/ai-quality/prompt")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ systemPrompt: "缺少结构化输出协议的普通说明" })
      .expect(400);
  });
});
