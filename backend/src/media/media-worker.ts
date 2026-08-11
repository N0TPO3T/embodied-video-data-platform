import "reflect-metadata";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { NestFactory } from "@nestjs/core";

import { MediaWorkerModule } from "./media-worker.module.js";
import { RabbitMediaWorker } from "./rabbit-media-worker.js";

async function start(): Promise<void> {
  const rabbitUrl = process.env.RABBITMQ_URL?.trim();
  if (!rabbitUrl) throw new Error("RABBITMQ_URL is required");
  const application = await NestFactory.createApplicationContext(
    MediaWorkerModule,
  );
  const worker = application.get(RabbitMediaWorker);
  await worker.start(rabbitUrl);
  const shutdown = async () => {
    await worker.close();
    await application.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await start();
}
