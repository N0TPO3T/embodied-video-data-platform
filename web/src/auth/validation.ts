import type { Role } from "../domain/types";

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const TEAM_IDS = new Set(["TEAM-01", "TEAM-02"]);

export function normalizeUsername(value: string): string {
  const username = value.trim();
  if (!USERNAME.test(username)) {
    throw new Error(
      "用户名需为 3 到 32 位字母、数字、点、下划线或连字符",
    );
  }
  return username.toLowerCase();
}

export function validatePassword(password: string): string {
  if (password.length < 8 || password.length > 64) {
    throw new Error("密码长度需为 8 到 64 位");
  }
  return password;
}

export function validateAccountFields(input: {
  displayName: string;
  username: string;
  role: Role;
  teamId?: string;
}) {
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 30) {
    throw new Error("显示名称需为 1 到 30 个字符");
  }

  const username = input.username.trim();
  const usernameNormalized = normalizeUsername(username);

  if (input.role === "admin") {
    return {
      displayName,
      username,
      usernameNormalized,
      role: input.role,
      teamId: undefined,
    };
  }

  if (!input.teamId || !TEAM_IDS.has(input.teamId)) {
    throw new Error("请选择有效团队");
  }

  return {
    displayName,
    username,
    usernameNormalized,
    role: input.role,
    teamId: input.teamId,
  };
}
