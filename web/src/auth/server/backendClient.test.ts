import { afterEach, describe, expect, it, vi } from "vitest";

import { makeAccountPublic } from "../testFactories";
import {
  getBackendSession,
  listBackendAccounts,
  listBackendTeams,
} from "./backendClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("backend server client", () => {
  it("forwards only the opaque session cookie", async () => {
    const user = makeAccountPublic({ role: "admin", teamId: undefined });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user, homePath: "/admin" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBackendSession("opaque-token")).resolves.toEqual({
      user,
      homePath: "/admin",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/auth/session",
      expect.objectContaining({
        cache: "no-store",
        headers: { cookie: "evdp_session=opaque-token" },
      }),
    );
  });

  it("treats a backend 401 as an unauthenticated session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "UNAUTHENTICATED", error: "请先登录" }),
          { status: 401 },
        ),
      ),
    );

    await expect(getBackendSession("expired-token")).resolves.toBeNull();
  });

  it("loads only accounts visible to the current actor", async () => {
    const account = makeAccountPublic({ role: "leader" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accounts: [account] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listBackendAccounts("opaque-token")).resolves.toEqual([
      account,
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/accounts",
      expect.objectContaining({
        headers: { cookie: "evdp_session=opaque-token" },
      }),
    );
  });

  it("loads only teams visible to the current actor with the session cookie", async () => {
    const team = {
      id: "TEAM-01",
      name: "星火一队",
      status: "active" as const,
      unitPricePerMinute: 12,
      createdAt: 1_722_708_000_000,
      updatedAt: 1_722_708_000_000,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ teams: [team] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listBackendTeams("opaque-token")).resolves.toEqual([team]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/teams",
      expect.objectContaining({
        headers: { cookie: "evdp_session=opaque-token" },
      }),
    );
  });
});
