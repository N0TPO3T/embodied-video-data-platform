import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { DeliveryFailure } from "./delivery-failure.js";

@Catch(DeliveryFailure)
export class DeliveryFailureFilter implements ExceptionFilter {
  catch(exception: DeliveryFailure, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(exception.status).json({
      code: exception.code,
      error: exception.message,
    });
  }
}
