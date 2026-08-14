import { RateLimitService } from "../src/security/rate-limit.service.js";

describe("RateLimitService", () => {
  it("limits repeated actions within a time window and reports retry time", () => {
    const service = new RateLimitService();
    const now = new Date("2026-08-13T00:00:00.000Z");

    expect(
      service.consume({
        key: "login:127.0.0.1:admin",
        limit: 2,
        windowMs: 60_000,
        now,
      }),
    ).toEqual({ allowed: true });
    expect(
      service.consume({
        key: "login:127.0.0.1:admin",
        limit: 2,
        windowMs: 60_000,
        now,
      }),
    ).toEqual({ allowed: true });
    expect(
      service.consume({
        key: "login:127.0.0.1:admin",
        limit: 2,
        windowMs: 60_000,
        now,
      }),
    ).toEqual({ allowed: false, retryAfterSeconds: 60 });

    expect(
      service.consume({
        key: "login:127.0.0.1:admin",
        limit: 2,
        windowMs: 60_000,
        now: new Date(now.getTime() + 60_000),
      }),
    ).toEqual({ allowed: true });
  });
});
