import {
  IdentityFailure,
  IdentityPolicy,
  type AccountMutation,
} from "../src/identity/identity.policy.js";
import type { PublicUser } from "../src/auth/auth.types.js";
import type { UserEntity } from "../src/database/entities/user.entity.js";

function actor(
  role: PublicUser["role"],
  teamId?: string,
): PublicUser {
  return {
    id: `ACTOR-${role}`,
    displayName: role,
    username: role,
    role,
    teamId,
    status: "active",
    updatedAt: 0,
  };
}

function target(
  role: UserEntity["role"],
  teamId: string | null,
): Pick<
  UserEntity,
  "id" | "displayName" | "username" | "role" | "teamId" | "status"
> {
  return {
    id: `TARGET-${role}`,
    displayName: role,
    username: `target-${role}`,
    role,
    teamId,
    status: "active",
  };
}

describe("IdentityPolicy", () => {
  const policy = new IdentityPolicy();
  const admin = actor("admin");
  const leader = actor("leader", "TEAM-01");
  const collector = actor("collector", "TEAM-01");

  it("returns the correct visibility scope for each role", () => {
    expect(policy.visibility(admin)).toEqual({ kind: "all" });
    expect(policy.visibility(leader)).toEqual({
      kind: "team",
      teamId: "TEAM-01",
    });
    expect(policy.visibility(collector)).toEqual({
      kind: "self",
      accountId: collector.id,
    });
  });

  it("allows a leader to create only an own-team collector", () => {
    const allowed: AccountMutation = {
      displayName: "新数采",
      username: "new-collector",
      role: "collector",
      teamId: "TEAM-01",
    };
    expect(() => policy.assertCanCreate(leader, allowed)).not.toThrow();
    expect(() =>
      policy.assertCanCreate(leader, { ...allowed, role: "leader" }),
    ).toThrow(IdentityFailure);
    expect(() =>
      policy.assertCanCreate(leader, { ...allowed, teamId: "TEAM-02" }),
    ).toThrow(IdentityFailure);
  });

  it("allows a leader to rename own-team collectors without changing identity fields", () => {
    const ownCollector = target("collector", "TEAM-01");
    expect(() =>
      policy.assertCanUpdate(leader, ownCollector, {
        displayName: "更新后的姓名",
        username: ownCollector.username,
        role: "collector",
        teamId: "TEAM-01",
      }),
    ).not.toThrow();

    expect(() =>
      policy.assertCanUpdate(leader, ownCollector, {
        displayName: "更新后的姓名",
        username: "changed-username",
        role: "collector",
        teamId: "TEAM-01",
      }),
    ).toThrow(IdentityFailure);
  });

  it("rejects leader cross-team, elevated-role, and collector management", () => {
    expect(() =>
      policy.assertCanManage(leader, target("collector", "TEAM-02")),
    ).toThrow(IdentityFailure);
    expect(() =>
      policy.assertCanManage(leader, target("leader", "TEAM-01")),
    ).toThrow(IdentityFailure);
    expect(() =>
      policy.assertCanManage(collector, target("collector", "TEAM-01")),
    ).toThrow(IdentityFailure);
  });

  it("reserves team management for administrators", () => {
    expect(() => policy.assertCanManageTeams(admin)).not.toThrow();
    expect(() => policy.assertCanManageTeams(leader)).toThrow(
      IdentityFailure,
    );
  });
});
