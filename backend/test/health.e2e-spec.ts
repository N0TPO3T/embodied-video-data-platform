import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";

import { HealthModule } from "../src/health/health.module.js";
import { configureApplication } from "../src/http/configure-application.js";

describe("health", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    })
      .overrideProvider(DataSource)
      .useValue({ query: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the stable public liveness response", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health/live")
      .expect(200);

    expect(response.body).toEqual({
      status: "ok",
      service: "evdp-api",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("reports PostgreSQL readiness without exposing connection details", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/health/ready")
      .expect(200);

    expect(response.body).toEqual({
      status: "ready",
      service: "evdp-api",
      database: "ready",
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /postgresql:|password|DATABASE_URL/i,
    );
  });
});
