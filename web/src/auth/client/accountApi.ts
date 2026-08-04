import type { AccountPublic } from "../contracts";

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
