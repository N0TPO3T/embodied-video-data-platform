import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import {
  parseEnvironment,
  type RawEnvironment,
} from "./config/environment.js";
import { configureApplication } from "./http/configure-application.js";

export { configureApplication } from "./http/configure-application.js";

async function bootstrap(): Promise<void> {
  const environment = parseEnvironment(process.env as RawEnvironment);
  const app = await NestFactory.create(AppModule);
  configureApplication(app, environment.webOrigin);
  await app.listen(environment.port, "0.0.0.0");
}

if (process.env.NODE_ENV !== "test") {
  void bootstrap();
}
