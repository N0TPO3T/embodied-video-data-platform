import { createAccountAuditHandler } from "@/src/auth/server/http";
import { getRuntimeServices } from "@/src/auth/server/runtime";

export const GET = createAccountAuditHandler(getRuntimeServices);
