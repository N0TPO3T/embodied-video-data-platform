import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { SubmissionFailure } from "./submission-failure.js";

@Catch(SubmissionFailure)
export class SubmissionFailureFilter implements ExceptionFilter {
  catch(exception: SubmissionFailure, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(exception.status).json({
      code: exception.code,
      error: exception.message,
    });
  }
}
