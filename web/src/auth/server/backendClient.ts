import { resolveApiBaseUrl } from "../../lib/api-base";
import type { AccountPublic, TeamPublic } from "../contracts";

type BackendSession = {
  user: AccountPublic;
  homePath: string;
};

function apiUrl(path: string): string {
  const base = resolveApiBaseUrl(
    process.env.BACKEND_INTERNAL_URL,
    "http://localhost:4000/api/v1",
  );
  return `${base.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
}

async function backendRequest<T>(
  path: string,
  sessionToken: string,
): Promise<T | null> {
  const response = await fetch(apiUrl(path), {
    cache: "no-store",
    headers: {
      cookie: `evdp_session=${sessionToken}`,
    },
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`后端请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
}

export function getBackendSession(
  sessionToken: string,
): Promise<BackendSession | null> {
  return backendRequest<BackendSession>("/auth/session", sessionToken);
}

export async function listBackendAccounts(
  sessionToken: string,
): Promise<AccountPublic[]> {
  const result = await backendRequest<{ accounts: AccountPublic[] }>(
    "/accounts",
    sessionToken,
  );
  return result?.accounts ?? [];
}

export async function listBackendTeams(
  sessionToken: string,
): Promise<TeamPublic[]> {
  const result = await backendRequest<{ teams: TeamPublic[] }>(
    "/teams",
    sessionToken,
  );
  return result?.teams ?? [];
}
