import { createAccountStatusHandler } from "@/src/auth/server/http";
import { getRuntimeServices } from "@/src/auth/server/runtime";

export const PATCH = createAccountStatusHandler(getRuntimeServices);
