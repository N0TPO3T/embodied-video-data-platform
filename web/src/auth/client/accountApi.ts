import type { AccountStatus } from "../../domain/types";
import type {
  AccountAuditLog,
  AccountPublic,
  CreateAccountInput,
  UpdateAccountInput,
} from "../contracts";

export class AccountApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AccountApiError";
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const errorPayload =
      payload && typeof payload === "object"
        ? (payload as { error?: unknown; code?: unknown })
        : {};
    throw new AccountApiError(
      response.status,
      typeof errorPayload.error === "string"
        ? errorPayload.error
        : "操作失败，请稍后重试",
      typeof errorPayload.code === "string"
        ? errorPayload.code
        : undefined,
    );
  }

  return payload as T;
}

export function login(
  username: string,
  password: string,
): Promise<{ user: AccountPublic; homePath: string }> {
  return requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<void> {
  return requestJson("/api/auth/logout", {
    method: "POST",
  });
}

export async function listAccounts(): Promise<AccountPublic[]> {
  const result = await requestJson<{ accounts: AccountPublic[] }>(
    "/api/admin/accounts",
  );
  return result.accounts;
}

export async function createAccount(
  input: CreateAccountInput,
): Promise<AccountPublic> {
  const result = await requestJson<{ account: AccountPublic }>(
    "/api/admin/accounts",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.account;
}

export async function updateAccount(
  id: string,
  input: UpdateAccountInput,
): Promise<AccountPublic> {
  const result = await requestJson<{ account: AccountPublic }>(
    `/api/admin/accounts/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return result.account;
}

export function resetAccountPassword(
  id: string,
  password: string,
): Promise<{ reauthenticate: boolean }> {
  return requestJson(
    `/api/admin/accounts/${encodeURIComponent(id)}/reset-password`,
    {
      method: "POST",
      body: JSON.stringify({ password }),
    },
  );
}

export async function setAccountStatus(
  id: string,
  status: AccountStatus,
): Promise<AccountPublic> {
  const result = await requestJson<{ account: AccountPublic }>(
    `/api/admin/accounts/${encodeURIComponent(id)}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  );
  return result.account;
}

export async function listAccountAudit(): Promise<AccountAuditLog[]> {
  const result = await requestJson<{ logs: AccountAuditLog[] }>(
    "/api/admin/account-audit",
  );
  return result.logs;
}
