import type { AccountStatus, Role } from "../domain/types";

export type AccountPublic = {
  id: string;
  displayName: string;
  username: string;
  role: Role;
  teamId?: string;
  status: AccountStatus;
  updatedAt: number;
};

export type TeamPublic = {
  id: string;
  name: string;
  status: "active" | "disabled";
  unitPricePerMinute: number;
  createdAt: number;
  updatedAt: number;
};

export type CreateTeamInput = Pick<
  TeamPublic,
  "name" | "unitPricePerMinute"
>;

export type UpdateTeamInput = CreateTeamInput &
  Pick<TeamPublic, "status">;

export type AccountAuditAction =
  | "create"
  | "update"
  | "reset_password"
  | "enable"
  | "disable";

export type AccountAuditLog = {
  id: string;
  actorAccountId: string;
  actorName: string;
  action: AccountAuditAction;
  targetAccountId: string;
  targetName: string;
  summary: string;
  createdAt: number;
};

export type CreateAccountInput = {
  displayName: string;
  username: string;
  password: string;
  role: Role;
  teamId?: string;
};

export type UpdateAccountInput = Omit<CreateAccountInput, "password">;
