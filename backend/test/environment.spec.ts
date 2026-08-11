import {
  parseEnvironment,
  type RawEnvironment,
} from "../src/config/environment.js";

function validEnvironment(
  overrides: Partial<RawEnvironment> = {},
): RawEnvironment {
  return {
    NODE_ENV: "test",
    PORT: "4000",
    DATABASE_URL: "postgresql://evdp:password@localhost:5432/evdp",
    WEB_ORIGIN: "http://localhost:3000",
    SESSION_SECRET: "local-session-secret-that-is-at-least-32-chars",
    REDIS_URL: "redis://localhost:6379/0",
    RABBITMQ_URL: "amqp://evdp:password@localhost:5672",
    MINIO_ENDPOINT: "http://localhost:9000",
    MINIO_ACCESS_KEY: "local-access-key",
    MINIO_SECRET_KEY: "local-secret-key",
    QDRANT_URL: "http://localhost:6333",
    ...overrides,
  };
}

describe("parseEnvironment", () => {
  it("rejects an empty session secret", () => {
    expect(() =>
      parseEnvironment(validEnvironment({ SESSION_SECRET: "" })),
    ).toThrow(/SESSION_SECRET/);
  });

  it("allows missing model credentials in phase one", () => {
    expect(
      parseEnvironment(validEnvironment({ QWEN_API_KEY: undefined })),
    ).toMatchObject({
      qwenApiKey: undefined,
      modelStatus: "not_configured",
    });
  });

  it("converts the port and validates service URLs", () => {
    expect(parseEnvironment(validEnvironment())).toMatchObject({
      port: 4000,
      databaseUrl: "postgresql://evdp:password@localhost:5432/evdp",
      webOrigin: "http://localhost:3000",
      qdrantUrl: "http://localhost:6333",
    });
    expect(() =>
      parseEnvironment(validEnvironment({ REDIS_URL: "not-a-url" })),
    ).toThrow(/REDIS_URL/);
  });
});
