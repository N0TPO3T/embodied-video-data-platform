import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "../app.module.js";
import { OutboxPublisherService } from "../messaging/outbox-publisher.service.js";

const application = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const result = await application
    .get(OutboxPublisherService)
    .publishBatch(100);
  console.log(JSON.stringify(result));
} finally {
  await application.close();
}
