import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { PointCycleFailure } from "./point-cycle-failure.js";

@Catch(PointCycleFailure)
export class PointCycleFailureFilter implements ExceptionFilter {
  catch(exception: PointCycleFailure, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(exception.status).json({
      code: exception.code,
      error: exception.message,
    });
  }
}
