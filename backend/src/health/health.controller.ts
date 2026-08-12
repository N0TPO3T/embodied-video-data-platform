import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { DataSource } from "typeorm";

@Controller("health")
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get("live")
  @Header("cache-control", "no-store")
  live(): { status: "ok"; service: "evdp-api" } {
    return {
      status: "ok",
      service: "evdp-api",
    };
  }

  @Get("ready")
  async ready(): Promise<{
    status: "ready";
    service: "evdp-api";
    database: "ready";
  }> {
    try {
      await this.dataSource.query("SELECT 1");
    } catch {
      throw new HttpException(
        {
          status: "not_ready",
          service: "evdp-api",
          database: "unavailable",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: "ready",
      service: "evdp-api",
      database: "ready",
    };
  }
}
