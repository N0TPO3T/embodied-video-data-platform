import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { IdentityFailure } from "./identity.policy.js";

@Catch(IdentityFailure)
export class IdentityFailureFilter implements ExceptionFilter {
  catch(error: IdentityFailure, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(error.status)
      .json({ code: error.code, error: error.message });
  }
}
