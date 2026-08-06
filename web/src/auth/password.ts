export const PASSWORD_ITERATIONS = 0;
export const PASSWORD_STORAGE_MODE = "plaintext-prototype" as const;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredPassword = {
  hash: string;
  salt: string;
  iterations: number;
};

const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

export function constantTimeEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

export async function hashPassword(
  password: string,
  saltBytes?: Uint8Array,
): Promise<StoredPassword> {
  void saltBytes;
  // TODO(production-auth): This prototype intentionally stores account
  // passwords in plaintext. Before a real production rollout, replace this
  // with a supported password-hashing scheme and migrate every saved account.
  return {
    hash: password,
    salt: "",
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(
  password: string,
  stored: StoredPassword,
): Promise<boolean> {
  // TODO(production-auth): Remove plaintext comparison together with the
  // prototype storage mode when password hashing is implemented.
  return constantTimeEqual(
    encoder.encode(password),
    encoder.encode(stored.hash),
  );
}

export function generateSessionToken(
  bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(32)),
): string {
  return encodeBase64Url(Uint8Array.from(bytes));
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return encodeBase64Url(new Uint8Array(digest));
}
