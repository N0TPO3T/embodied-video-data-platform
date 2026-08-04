// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, hashSessionToken } from "../password";
import { createAuthService, type AuthService } from "./authService";
import { createD1AccountRepository } from "./d1AccountRepository";
import {
  makeAccountRecord,
  makeAudit,
} from "./testFactories";
import { createTestD1 } from "./testD1";

type AuthFixture = {
  service: AuthService;
  repo: ReturnType<typeof createD1AccountRepository>;
  dispose: () => Promise<void>;
  advance: (milliseconds: number) => void;
};

const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

async function authenticatedFixture(): Promise<AuthFixture> {
  const { db, dispose } = await createTestD1();
  disposers.push(dispose);
  const repo = createD1AccountRepository(db);
  const stored = await hashPassword(
    "admin123",
    new Uint8Array(16).fill(3),
  );
  const admin = makeAccountRecord({
    id: "U-ADMIN-01",
    displayName: "管理员",
    username: "admin",
    usernameNormalized: "admin",
    role: "admin",
    teamId: undefined,
    passwordHash: stored.hash,
    passwordSalt: stored.salt,
    passwordIterations: stored.iterations,
  });
  await repo.createAccount(admin, makeAudit(admin));
  let currentTime = 1_722_708_000_000;
  const service = createAuthService(repo, {
    now: () => currentTime,
    randomSessionBytes: () => new Uint8Array(32).fill(8),
  });

  return {
    service,
    repo,
    dispose,
    advance: (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
}

describe("AuthService", () => {
  it("logs in with a normalized username and creates a stored session", async () => {
    const { service, repo } = await authenticatedFixture();

    const result = await service.login("  ADMIN ", "admin123");

    expect(result.user).toMatchObject({
      id: "U-ADMIN-01",
      role: "admin",
    });
    expect(result.token).not.toContain("admin");
    await expect(
      repo.findSessionAccount(
        await hashSessionToken(result.token),
        1_722_708_000_001,
      ),
    ).resolves.toMatchObject({ id: "U-ADMIN-01" });
  });

  it("returns the same invalid-credentials error for unknown users and bad passwords", async () => {
    const { service } = await authenticatedFixture();

    await expect(service.login("missing", "wrong-pass")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await expect(service.login("admin", "wrong-pass")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("rejects disabled accounts", async () => {
    const { service, repo } = await authenticatedFixture();
    const admin = await repo.findById("U-ADMIN-01");
    if (!admin) throw new Error("fixture account missing");
    await repo.setStatus(
      { ...admin, status: "disabled" },
      {
        ...makeAudit(admin),
        id: "AUD-DISABLE",
        action: "disable",
      },
    );

    await expect(service.login("admin", "admin123")).rejects.toMatchObject({
      code: "DISABLED",
    });
  });

  it("locks an account after five failures in fifteen minutes", async () => {
    const { service, repo, advance } = await authenticatedFixture();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        service.login("admin", "wrong-pass"),
      ).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    }
    await expect(service.login("admin", "wrong-pass")).rejects.toMatchObject({
      code: "LOCKED",
    });
    await expect(service.login("admin", "admin123")).rejects.toMatchObject({
      code: "LOCKED",
    });

    advance(15 * 60 * 1_000 + 1);

    await expect(service.login("admin", "admin123")).resolves.toMatchObject({
      user: { role: "admin" },
    });
    expect(
      (await repo.findById("U-ADMIN-01"))?.failedAttemptCount,
    ).toBe(0);
  });

  it("authenticates and then removes an opaque session on logout", async () => {
    const { service } = await authenticatedFixture();
    const { token } = await service.login("admin", "admin123");

    await expect(service.authenticate(token)).resolves.toMatchObject({
      username: "admin",
    });
    await service.logout(token);
    await expect(service.authenticate(token)).resolves.toBeNull();
  });
});
