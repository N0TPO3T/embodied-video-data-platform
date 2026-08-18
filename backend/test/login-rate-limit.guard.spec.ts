import type { ExecutionContext } from "@nestjs/common";

import { LoginRateLimitGuard } from "../src/security/login-rate-limit.guard.js";
import type { RateLimitService } from "../src/security/rate-limit.service.js";

describe("LoginRateLimitGuard", () => {
  it("uses Express's trusted request IP and ignores a raw forwarded-for header", async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: true });
    const request = {
      body: { username: " Admin " },
      headers: { "x-forwarded-for": "203.0.113.99" },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.2" },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader: vi.fn() }),
      }),
    } as unknown as ExecutionContext;
    const guard = new LoginRateLimitGuard({ consume } as unknown as RateLimitService);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(consume).toHaveBeenNthCalledWith(1, expect.objectContaining({
      key: "login:ip:127.0.0.1",
    }));
    expect(consume).toHaveBeenNthCalledWith(2, expect.objectContaining({
      key: "login:ip-account:127.0.0.1:admin",
    }));
    expect(consume.mock.calls.flat().join(" ")).not.toContain("203.0.113.99");
  });
});
