import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { OperationsFailure } from "./operations-failure.js";

@Catch(OperationsFailure)
export class OperationsFailureFilter implements ExceptionFilter {
  catch(exception: OperationsFailure, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(exception.status).json({
      code: exception.code,
      error: exception.message,
    });
  }
}
