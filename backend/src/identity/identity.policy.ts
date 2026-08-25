import { Injectable } from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import type {
  UserEntity,
  UserRole,
} from "../database/entities/user.entity.js";

export type AccountMutation = {
  displayName: string;
  username: string;
  role: UserRole;
  teamId?: string;
};

export type AccountVisibility =
  | { kind: "all" }
  | { kind: "team"; teamId: string }
  | { kind: "self"; accountId: string };

export class IdentityFailure extends Error {
  constructor(
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "VALIDATION",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "IdentityFailure";
  }
}

type ManageableAccount = Pick<
  UserEntity,
  "id" | "displayName" | "username" | "role" | "teamId" | "status"
>;

function assertActive(actor: PublicUser): void {
  if (actor.status !== "active") {
    throw new IdentityFailure("FORBIDDEN", "账号已停用", 403);
  }
}

@Injectable()
export class IdentityPolicy {
  visibility(actor: PublicUser): AccountVisibility {
    assertActive(actor);
    if (actor.role === "admin") return { kind: "all" };
    if (actor.role === "leader" && actor.teamId) {
      return { kind: "team", teamId: actor.teamId };
    }
    return { kind: "self", accountId: actor.id };
  }

  assertCanCreate(actor: PublicUser, input: AccountMutation): void {
    assertActive(actor);
    if (actor.role === "admin") return;
    if (
      actor.role === "leader" &&
      actor.teamId &&
      input.role === "collector" &&
      input.teamId === actor.teamId
    ) {
      return;
    }
    throw new IdentityFailure(
      "FORBIDDEN",
      "只能创建本团队的数采人员账号",
      403,
    );
  }

  assertCanManage(actor: PublicUser, target: ManageableAccount): void {
    assertActive(actor);
    if (actor.role === "admin") return;
    if (
      actor.role === "leader" &&
      actor.teamId &&
      target.role === "collector" &&
      target.teamId === actor.teamId
    ) {
      return;
    }
    throw new IdentityFailure(
      "FORBIDDEN",
      "无权管理该账号",
      403,
    );
  }

  assertCanDelete(actor: PublicUser): void {
    assertActive(actor);
    if (actor.role !== "admin") {
      throw new IdentityFailure(
        "FORBIDDEN",
        "仅管理员可删除账号",
        403,
      );
    }
  }

  assertCanUpdate(
    actor: PublicUser,
    target: ManageableAccount,
    input: AccountMutation,
  ): void {
    this.assertCanManage(actor, target);
    if (actor.role === "admin") return;
    if (
      input.username !== target.username ||
      input.role !== target.role ||
      input.teamId !== target.teamId
    ) {
      throw new IdentityFailure(
        "FORBIDDEN",
        "团长不能修改用户名、角色或所属团队",
        403,
      );
    }
  }

  assertCanManageTeams(actor: PublicUser): void {
    assertActive(actor);
    if (actor.role !== "admin") {
      throw new IdentityFailure(
        "FORBIDDEN",
        "仅管理员可管理团队",
        403,
      );
    }
  }
}
