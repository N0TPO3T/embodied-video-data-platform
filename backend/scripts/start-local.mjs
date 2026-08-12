import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function runNodeScript(scriptUrl) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [fileURLToPath(scriptUrl)], {
      env: process.env,
      stdio: "inherit",
    });
    let forwardedSignal = null;

    const forwardSignal = (signal) => {
      forwardedSignal ??= signal;
      child.kill(signal);
    };
    const cleanup = () => {
      process.removeListener("SIGINT", forwardSignal);
      process.removeListener("SIGTERM", forwardSignal);
    };

    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);
    child.once("error", (error) => {
      cleanup();
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolveRun({
        code,
        signal: forwardedSignal ?? signal,
      });
    });
  });
}

async function runLocalBackend() {
  const startupScripts = [
    new URL("../dist/database/run-migrations.js", import.meta.url),
    new URL("../dist/cli/bootstrap-local-identity.js", import.meta.url),
    new URL("../dist/main.js", import.meta.url),
  ];

  for (const scriptUrl of startupScripts) {
    const result = await runNodeScript(scriptUrl);
    if (result.signal || result.code !== 0) return result;
  }

  return { code: 0, signal: null };
}

const result = await runLocalBackend();
if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exitCode = result.code ?? 1;
}
