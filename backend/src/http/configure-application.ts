import { ValidationPipe, type INestApplication } from "@nestjs/common";

export function configureApplication(
  app: INestApplication,
  webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000",
): void {
  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin: webOrigin,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
}
