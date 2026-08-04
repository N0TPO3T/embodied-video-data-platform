import { env } from "cloudflare:workers";
import { createAccountService } from "./accountService";
import { createAuthService } from "./authService";
import { ensureInitialAccounts } from "./bootstrapAccounts";
import { createD1AccountRepository } from "./d1AccountRepository";

export async function getRuntimeServices() {
  const runtimeEnv = env as typeof env & {
    INITIAL_ACCOUNT_PASSWORDS?: string;
  };
  if (!runtimeEnv.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable");
  }

  const repository = createD1AccountRepository(runtimeEnv.DB);
  await ensureInitialAccounts(
    repository,
    runtimeEnv.INITIAL_ACCOUNT_PASSWORDS,
  );
  return {
    auth: createAuthService(repository),
    accounts: createAccountService(repository),
  };
}

export async function getRuntimeAuthService() {
  return (await getRuntimeServices()).auth;
}
