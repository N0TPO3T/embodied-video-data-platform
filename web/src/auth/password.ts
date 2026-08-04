export const PASSWORD_ITERATIONS = 600_000;
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

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: Uint8Array.from(salt),
      iterations,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
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
  saltBytes = crypto.getRandomValues(new Uint8Array(16)),
): Promise<StoredPassword> {
  const salt = Uint8Array.from(saltBytes);
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return {
    hash: encodeBase64Url(hash),
    salt: encodeBase64Url(salt),
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(
  password: string,
  stored: StoredPassword,
): Promise<boolean> {
  try {
    const salt = decodeBase64Url(stored.salt);
    const expected = decodeBase64Url(stored.hash);
    const actual = await derivePassword(password, salt, stored.iterations);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
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
