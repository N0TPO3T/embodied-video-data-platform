import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { TaskFailure } from "./tasks.failure.js";

@Catch(TaskFailure)
export class TaskFailureFilter implements ExceptionFilter {
  catch(exception: TaskFailure, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(exception.status).json({
      code: exception.code,
      error: exception.message,
    });
  }
}
