import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAccountPublic } from "../testFactories";
import {
  AccountApiError,
  accountAuditExportUrl,
  assignTeamLeader,
  createAccount,
  createTeam,
  changeOwnPassword,
  login,
  listAccountAudit,
  listAccounts,
  listTeams,
  logout,
  resetAccountPassword,
  searchAccountAudit,
  setAccountStatus,
  updateAccount,
  updateTeam,
} from "./accountApi";

const TEST_PASSWORD = "test-password-admin";

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

    await expect(login("admin", TEST_PASSWORD)).resolves.toEqual({
      user,
      homePath: "/admin",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          username: "admin",
          password: TEST_PASSWORD,
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

  it("posts an authenticated password change and accepts the revoked-session response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      changeOwnPassword("current-password", "new-password"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/accounts/me/change-password",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          currentPassword: "current-password",
          newPassword: "new-password",
        }),
      }),
    );
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
      "http://localhost:4000/api/v1/accounts",
      "http://localhost:4000/api/v1/accounts",
      "http://localhost:4000/api/v1/accounts/U%2FADMIN%2002",
      "http://localhost:4000/api/v1/accounts/U%2FADMIN%2002/reset-password",
      "http://localhost:4000/api/v1/accounts/U%2FADMIN%2002/status",
      "http://localhost:4000/api/v1/audit-logs",
    ]);
  });

  it("sends audit log search filters as query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          logs: [],
          pagination: {
            page: 2,
            pageSize: 20,
            total: 0,
            totalPages: 1,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchAccountAudit({
        q: "密码",
        actor: "管理员",
        action: "reset_password",
        from: "2026-08-04",
        to: "2026-08-05",
        page: 2,
        pageSize: 20,
      }),
    ).resolves.toMatchObject({
      pagination: {
        page: 2,
        pageSize: 20,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/audit-logs?q=%E5%AF%86%E7%A0%81&actor=%E7%AE%A1%E7%90%86%E5%91%98&action=reset_password&from=2026-08-04&to=2026-08-05&page=2&pageSize=20",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(
      accountAuditExportUrl({
        q: " 密码 ",
        actor: "管理员",
        action: "reset_password",
        from: "2026-08-04",
        to: "2026-08-05",
        page: 2,
        pageSize: 20,
      }),
    ).toBe(
      "http://localhost:4000/api/v1/audit-logs/export.csv?q=%E5%AF%86%E7%A0%81&actor=%E7%AE%A1%E7%90%86%E5%91%98&action=reset_password&from=2026-08-04&to=2026-08-05",
    );
  });

  it("maps team list and mutations to typed values", async () => {
    const team = {
      id: "TEAM-01",
      name: "星火一队",
      status: "active" as const,
      unitPricePerMinute: 12,
      createdAt: 1_722_708_000_000,
      updatedAt: 1_722_708_000_000,
    };
    const fetchMock = vi
      .fn()
      .mockImplementation((_input, init?: RequestInit) =>
        Promise.resolve(
          new Response(JSON.stringify({
            team,
            teams: [team],
            accounts: init?.body === JSON.stringify({ accountId: "U-LEAD-01" })
              ? [{ id: "U-LEAD-01" }]
              : undefined,
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listTeams()).resolves.toEqual([team]);
    await expect(
      createTeam({ name: "星火一队", unitPricePerMinute: 12 }),
    ).resolves.toEqual(team);
    await expect(
      updateTeam("TEAM/01", {
        name: "星火一队",
        unitPricePerMinute: 13,
        status: "disabled",
      }),
    ).resolves.toEqual(team);
    await expect(
      assignTeamLeader("TEAM/01", "U-LEAD-01"),
    ).resolves.toEqual([{ id: "U-LEAD-01" }]);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:4000/api/v1/teams",
      "http://localhost:4000/api/v1/teams",
      "http://localhost:4000/api/v1/teams/TEAM%2F01",
      "http://localhost:4000/api/v1/teams/TEAM%2F01/leader",
    ]);
  });
});
