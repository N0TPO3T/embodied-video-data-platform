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

  @Get("version")
  @Header("cache-control", "no-store")
  version(): {
    service: "evdp-api";
    version: string;
    revision: string;
    builtAt: string;
  } {
    return {
      service: "evdp-api",
      version: process.env.EVDP_RELEASE_VERSION?.trim() || "dev",
      revision: process.env.EVDP_GIT_SHA?.trim() || "unknown",
      builtAt: process.env.EVDP_BUILD_TIME?.trim() || "unknown",
    };
  }

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
