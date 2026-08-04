import { createLoginHandler } from "@/src/auth/server/http";
import { getRuntimeAuthService } from "@/src/auth/server/runtime";

export const POST = createLoginHandler(getRuntimeAuthService);
