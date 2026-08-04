import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./password";

const TEST_PASSWORD = "test-password-admin";

describe("password and session cryptography", () => {
  it("hashes and verifies a password without storing plaintext", async () => {
    const stored = await hashPassword(
      TEST_PASSWORD,
      new Uint8Array(16).fill(7),
    );

    expect(stored.hash).not.toContain(TEST_PASSWORD);
    expect(stored.iterations).toBe(600_000);
    await expect(verifyPassword(TEST_PASSWORD, stored)).resolves.toBe(true);
    await expect(verifyPassword("wrong-pass", stored)).resolves.toBe(false);
  });

  it("creates opaque tokens and stable token digests", async () => {
    const token = generateSessionToken(new Uint8Array(32).fill(9));

    expect(token).not.toContain("=");
    await expect(hashSessionToken(token)).resolves.toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });
});
