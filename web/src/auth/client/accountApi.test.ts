import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAccountPublic } from "../server/testFactories";
import {
  AccountApiError,
  login,
  logout,
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
});
