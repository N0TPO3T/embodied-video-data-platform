import type { AccountPublic } from "../auth/contracts";
import { demoSeed } from "../data/demoData";
import type { Role } from "../domain/types";

export const demoAccounts: AccountPublic[] = demoSeed.users.map(
  (user) => ({
    id: user.id,
    displayName: user.name,
    username: user.account,
    role: user.role,
    teamId: user.teamId,
    status: user.status,
    updatedAt: user.updatedAt,
  }),
);

export function accountForRole(role: Role): AccountPublic {
  const account = demoAccounts.find((candidate) => candidate.role === role);
  if (!account) {
    throw new Error(`Missing ${role} test account`);
  }
  return account;
}
