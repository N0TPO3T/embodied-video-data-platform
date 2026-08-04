import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAccountPublic } from "../server/testFactories";
import {
  AccountApiError,
  createAccount,
  login,
  listAccountAudit,
  listAccounts,
  logout,
  resetAccountPassword,
  setAccountStatus,
  updateAccount,
} from "./accountApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account API client", () => {
  it("returns the authenticated account and role home", async () => {
    const user = makeAccountPublic({
      role: "admin",
      teamId: undefined,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ user, homePath: "/admin" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(login("admin", "admin123")).resolves.toEqual({
      user,
      homePath: "/admin",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          username: "admin",
          password: "admin123",
        }),
      }),
    );
  });

  it("surfaces a safe server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "INVALID_CREDENTIALS",
            error: "用户名或密码错误",
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await expect(login("admin", "wrong-pass")).rejects.toEqual(
      new AccountApiError(401, "用户名或密码错误", "INVALID_CREDENTIALS"),
    );
  });

  it("accepts an empty successful logout response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(logout()).resolves.toBeUndefined();
  });

  it("maps administrator account responses to typed values", async () => {
    const account = makeAccountPublic({
      id: "U-ADMIN-02",
      role: "admin",
      teamId: undefined,
    });
    const responses = [
      { accounts: [account] },
      { account },
      { account: { ...account, displayName: "管理员2" } },
      { reauthenticate: false },
      { account: { ...account, status: "disabled" } },
      { logs: [] },
    ];
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(responses.shift()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAccounts()).resolves.toEqual([account]);
    await expect(
      createAccount({
        displayName: "管理员2",
        username: "admin2",
        password: "admin234",
        role: "admin",
      }),
    ).resolves.toEqual(account);
    await expect(
      updateAccount("U/ADMIN 02", {
        displayName: "管理员2",
        username: "admin2",
        role: "admin",
      }),
    ).resolves.toMatchObject({ displayName: "管理员2" });
    await expect(
      resetAccountPassword("U/ADMIN 02", "newadmin234"),
    ).resolves.toEqual({ reauthenticate: false });
    await expect(
      setAccountStatus("U/ADMIN 02", "disabled"),
    ).resolves.toMatchObject({ status: "disabled" });
    await expect(listAccountAudit()).resolves.toEqual([]);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/accounts",
      "/api/admin/accounts",
      "/api/admin/accounts/U%2FADMIN%2002",
      "/api/admin/accounts/U%2FADMIN%2002/reset-password",
      "/api/admin/accounts/U%2FADMIN%2002/status",
      "/api/admin/account-audit",
    ]);
  });
});
