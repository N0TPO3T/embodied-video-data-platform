import { createSessionHandler } from "@/src/auth/server/http";
import { getRuntimeAuthService } from "@/src/auth/server/runtime";

export const GET = createSessionHandler(getRuntimeAuthService);
