import { createAccountsCollectionHandlers } from "@/src/auth/server/http";
import { getRuntimeServices } from "@/src/auth/server/runtime";

const handlers = createAccountsCollectionHandlers(getRuntimeServices);

export const GET = handlers.GET;
export const POST = handlers.POST;
