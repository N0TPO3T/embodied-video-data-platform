export type RawEnvironment = {
  NODE_ENV?: string;
  PORT?: string;
  DATABASE_URL?: string;
  WEB_ORIGIN?: string;
  REDIS_URL?: string;
  RABBITMQ_URL?: string;
  MINIO_ENDPOINT?: string;
  MINIO_ACCESS_KEY?: string;
  MINIO_SECRET_KEY?: string;
  QWEN_API_KEY?: string;
  EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS?: string;
  TRUST_PROXY_HOPS?: string;
};

export type Environment = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  webOrigin: string;
  redisUrl: string;
  rabbitmqUrl: string;
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  qwenApiKey?: string;
  modelStatus: "configured" | "not_configured";
  trustProxyHops: number;
};

const LOCAL_DEFAULT_ENV_VALUES: Partial<Record<keyof RawEnvironment, string>> = {
  MINIO_ACCESS_KEY: "evdp_local_minio",
  MINIO_SECRET_KEY: "evdp_local_minio_password",
};

const LOCAL_DEFAULT_URL_PARTS: Partial<Record<keyof RawEnvironment, string[]>> = {
  DATABASE_URL: ["evdp_local_postgres_password"],
  REDIS_URL: ["evdp_local_redis_password"],
  RABBITMQ_URL: ["evdp_local_rabbitmq_password"],
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

  const allowLocalDefaults =
    source.EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS === "true";
  if (rawNodeEnv === "production" && !allowLocalDefaults) {
    for (const [key, localValue] of Object.entries(LOCAL_DEFAULT_ENV_VALUES)) {
      if (source[key as keyof RawEnvironment]?.trim() === localValue) {
        throw new Error(
          `${key} uses a local default value; rotate it or set EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS=true for local-only startup`,
        );
      }
    }
    for (const [key, localParts] of Object.entries(LOCAL_DEFAULT_URL_PARTS)) {
      const value = source[key as keyof RawEnvironment]?.trim() ?? "";
      if (localParts.some((part) => value.includes(part))) {
        throw new Error(
          `${key} uses local default credentials; rotate them or set EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS=true for local-only startup`,
        );
      }
    }
  }

  const qwenApiKey = source.QWEN_API_KEY?.trim() || undefined;
  const trustProxyHops = Number(source.TRUST_PROXY_HOPS ?? "0");
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 10");
  }

  return {
    nodeEnv: rawNodeEnv as Environment["nodeEnv"],
    port,
    databaseUrl: serviceUrl(source, "DATABASE_URL", [
      "postgres:",
      "postgresql:",
    ]),
    webOrigin: serviceUrl(source, "WEB_ORIGIN", ["http:", "https:"]),
    redisUrl: serviceUrl(source, "REDIS_URL", ["redis:", "rediss:"]),
    rabbitmqUrl: serviceUrl(source, "RABBITMQ_URL", ["amqp:", "amqps:"]),
    minioEndpoint: serviceUrl(source, "MINIO_ENDPOINT", ["http:", "https:"]),
    minioAccessKey: required(source, "MINIO_ACCESS_KEY"),
    minioSecretKey: required(source, "MINIO_SECRET_KEY"),
    qwenApiKey,
    modelStatus: qwenApiKey ? "configured" : "not_configured",
    trustProxyHops,
  };
}
