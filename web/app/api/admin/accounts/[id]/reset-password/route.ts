import { createPasswordResetHandler } from "@/src/auth/server/http";
import { getRuntimeServices } from "@/src/auth/server/runtime";

export const POST = createPasswordResetHandler(getRuntimeServices);
