function pointServiceToLocalhost(name, serviceHost, localPort) {
  const value = process.env[name];
  if (!value) return;
  const url = new URL(value);
  if (url.hostname === serviceHost) {
    url.hostname = "127.0.0.1";
    url.port = String(localPort);
    process.env[name] = url.toString();
  }
}

pointServiceToLocalhost("DATABASE_URL", "postgres", 55432);
pointServiceToLocalhost("REDIS_URL", "redis", 6379);
pointServiceToLocalhost("RABBITMQ_URL", "rabbitmq", 5672);
pointServiceToLocalhost("MINIO_ENDPOINT", "minio", 9000);
pointServiceToLocalhost("QDRANT_URL", "qdrant", 6333);

process.env.NODE_ENV = "production";
process.env.PORT ??= "4000";

const { createDataSource } = await import(
  "../dist/database/data-source.js"
);
const dataSource = createDataSource();
try {
  await dataSource.initialize();
  await dataSource.runMigrations();
} finally {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}

await import("../dist/main.js");
