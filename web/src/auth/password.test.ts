import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  PASSWORD_STORAGE_MODE,
  verifyPassword,
} from "./password";

const TEST_PASSWORD = "test-password-admin";

describe("password and session cryptography", () => {
  it("uses the explicitly temporary plaintext prototype mode", async () => {
    const stored = await hashPassword(
      TEST_PASSWORD,
      new Uint8Array(16).fill(7),
    );

    expect(PASSWORD_STORAGE_MODE).toBe("plaintext-prototype");
    expect(stored).toEqual({
      hash: TEST_PASSWORD,
      salt: "",
      iterations: 0,
    });
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
