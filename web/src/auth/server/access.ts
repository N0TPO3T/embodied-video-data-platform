import type { Role } from "../../domain/types";
import type { AccountPublic } from "../contracts";

export type RouteAccess =
  | { kind: "allow" }
  | { kind: "redirect"; location: string };

export function roleHome(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "leader") return "/team";
  return "/collector";
}

function requiredRole(path: string): Role | null {
  if (path === "/admin" || path.startsWith("/admin/")) return "admin";
  if (path === "/team" || path.startsWith("/team/")) return "leader";
  if (path === "/collector" || path.startsWith("/collector/")) {
    return "collector";
  }
  return null;
}

export function resolveRouteAccess(
  path: string,
  account: AccountPublic | null,
): RouteAccess {
  if (path === "/") return { kind: "allow" };

  if (path === "/login") {
    return account
      ? { kind: "redirect", location: roleHome(account.role) }
      : { kind: "allow" };
  }

  if (!account) {
    return { kind: "redirect", location: "/login" };
  }

  const role = requiredRole(path);
  if (role && role !== account.role) {
    return {
      kind: "redirect",
      location: roleHome(account.role),
    };
  }

  return { kind: "allow" };
}
