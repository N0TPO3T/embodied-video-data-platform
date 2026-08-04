import { env } from "cloudflare:workers";
import { createAccountService } from "./accountService";
import { createAuthService } from "./authService";
import { ensureInitialAccounts } from "./bootstrapAccounts";
import { createD1AccountRepository } from "./d1AccountRepository";

export async function getRuntimeServices() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable");
  }

  const repository = createD1AccountRepository(env.DB);
  await ensureInitialAccounts(repository);
  return {
    auth: createAuthService(repository),
    accounts: createAccountService(repository),
  };
}

export async function getRuntimeAuthService() {
  return (await getRuntimeServices()).auth;
}
