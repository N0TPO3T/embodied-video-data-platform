export type RawEnvironment = {
  NODE_ENV?: string;
  PORT?: string;
  DATABASE_URL?: string;
  WEB_ORIGIN?: string;
  SESSION_SECRET?: string;
  REDIS_URL?: string;
  RABBITMQ_URL?: string;
  MINIO_ENDPOINT?: string;
  MINIO_ACCESS_KEY?: string;
  MINIO_SECRET_KEY?: string;
  QDRANT_URL?: string;
  QWEN_API_KEY?: string;
};

export type Environment = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  webOrigin: string;
  sessionSecret: string;
  redisUrl: string;
  rabbitmqUrl: string;
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  qdrantUrl: string;
  qwenApiKey?: string;
  modelStatus: "configured" | "not_configured";
};

function required(
  source: RawEnvironment,
  key: keyof RawEnvironment,
): string {
  const value = source[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function serviceUrl(
  source: RawEnvironment,
  key: keyof RawEnvironment,
  protocols: string[],
): string {
  const value = required(source, key);
  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    return value;
  } catch {
    throw new Error(`${key} must be a valid ${protocols.join(" or ")} URL`);
  }
}

export function parseEnvironment(source: RawEnvironment): Environment {
  const rawNodeEnv = source.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(rawNodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  const rawPort = source.PORT ?? "4000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  const sessionSecret = required(source, "SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }

  const qwenApiKey = source.QWEN_API_KEY?.trim() || undefined;

  return {
    nodeEnv: rawNodeEnv as Environment["nodeEnv"],
    port,
    databaseUrl: serviceUrl(source, "DATABASE_URL", [
      "postgres:",
      "postgresql:",
    ]),
    webOrigin: serviceUrl(source, "WEB_ORIGIN", ["http:", "https:"]),
    sessionSecret,
    redisUrl: serviceUrl(source, "REDIS_URL", ["redis:", "rediss:"]),
    rabbitmqUrl: serviceUrl(source, "RABBITMQ_URL", ["amqp:", "amqps:"]),
    minioEndpoint: serviceUrl(source, "MINIO_ENDPOINT", ["http:", "https:"]),
    minioAccessKey: required(source, "MINIO_ACCESS_KEY"),
    minioSecretKey: required(source, "MINIO_SECRET_KEY"),
    qdrantUrl: serviceUrl(source, "QDRANT_URL", ["http:", "https:"]),
    qwenApiKey,
    modelStatus: qwenApiKey ? "configured" : "not_configured",
  };
}
