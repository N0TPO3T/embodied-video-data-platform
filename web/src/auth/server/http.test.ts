// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { SESSION_TTL_MS } from "../password";
import {
  AccountServiceError,
  type AccountService,
} from "./accountService";
import type { AuthService } from "./authService";
import {
  createAccountsCollectionHandlers,
  createLoginHandler,
  createPasswordResetHandler,
} from "./http";
import { makeAccountPublic } from "./testFactories";

function authService(
  overrides: Partial<AuthService> = {},
): AuthService {
  return {
    login: vi.fn().mockResolvedValue({
      user: makeAccountPublic({
        role: "admin",
        teamId: undefined,
      }),
      token: "raw-token",
      expiresAt: 1_722_708_000_000 + SESSION_TTL_MS,
    }),
    authenticate: vi.fn().mockResolvedValue(
      makeAccountPublic({
        role: "admin",
        teamId: undefined,
      }),
    ),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function accountService(
  overrides: Partial<AccountService> = {},
): AccountService {
  return {
    listVisible: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    resetPassword: vi.fn(),
    setStatus: vi.fn(),
    listAudit: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("authentication HTTP handlers", () => {
  it("sets a secure opaque cookie and never returns credentials", async () => {
    const handler = createLoginHandler(async () => authService());
    const response = await handler(
      new Request("https://app.test/api/auth/login", {
        method: "POST",
        headers: {
          origin: "https://app.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: "admin",
          password: "admin123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "evdp_session=raw-token",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(await response.text()).not.toMatch(
      /admin123|password|sessionToken|raw-token/iu,
    );
  });

  it("rejects cross-origin mutations before they reach account services", async () => {
    const handler = createLoginHandler(async () => authService());
    const response = await handler(
      new Request("https://app.test/api/auth/login", {
        method: "POST",
        headers: {
          origin: "https://evil.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: "admin",
          password: "admin123",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "请求来源无效",
    });
  });

  it("maps duplicate usernames to a safe conflict response", async () => {
    const auth = authService();
    const accounts = accountService({
      create: vi.fn().mockRejectedValue(
        new AccountServiceError("CONFLICT", "用户名已存在"),
      ),
    });
    const { POST } = createAccountsCollectionHandlers(async () => ({
      auth,
      accounts,
    }));
    const response = await POST(
      new Request("https://app.test/api/admin/accounts", {
        method: "POST",
        headers: {
          origin: "https://app.test",
          cookie: "evdp_session=session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: "管理员2",
          username: "ADMIN",
          password: "admin234",
          role: "admin",
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "CONFLICT",
      error: "用户名已存在",
    });
  });

  it("returns unauthorized when an administrator endpoint has no valid session", async () => {
    const auth = authService({
      authenticate: vi.fn().mockResolvedValue(null),
    });
    const { GET } = createAccountsCollectionHandlers(async () => ({
      auth,
      accounts: accountService(),
    }));
    const response = await GET(
      new Request("https://app.test/api/admin/accounts"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "请先登录",
    });
  });

  it("clears the current session cookie after a self password reset", async () => {
    const auth = authService();
    const accounts = accountService({
      resetPassword: vi
        .fn()
        .mockResolvedValue({ reauthenticate: true }),
    });
    const handler = createPasswordResetHandler(async () => ({
      auth,
      accounts,
    }));
    const response = await handler(
      new Request(
        "https://app.test/api/admin/accounts/U-ADMIN-01/reset-password",
        {
          method: "POST",
          headers: {
            origin: "https://app.test",
            cookie: "evdp_session=session-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ password: "newadmin123" }),
        },
      ),
      { params: Promise.resolve({ id: "U-ADMIN-01" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "evdp_session=;",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    await expect(response.json()).resolves.toEqual({
      reauthenticate: true,
    });
  });
});
