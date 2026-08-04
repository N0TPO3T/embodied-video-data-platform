import type {
  AccountPublic,
  AccountRecord,
  AccountRepository,
} from "../contracts";
import {
  generateSessionToken,
  hashSessionToken,
  PASSWORD_ITERATIONS,
  SESSION_TTL_MS,
  verifyPassword,
} from "../password";
import { normalizeUsername } from "../validation";

const FAILURE_WINDOW_MS = 15 * 60 * 1_000;
const LOCK_DURATION_MS = 15 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 5;

const DUMMY_PASSWORD = {
  hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  salt: "AAAAAAAAAAAAAAAAAAAAAA",
  iterations: PASSWORD_ITERATIONS,
};

export class AuthError extends Error {
  constructor(
    readonly code:
      | "INVALID_CREDENTIALS"
      | "DISABLED"
      | "LOCKED"
      | "UNAUTHENTICATED"
      | "FORBIDDEN",
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type AuthService = {
  login(
    username: string,
    password: string,
  ): Promise<{
    user: AccountPublic;
    token: string;
    expiresAt: number;
  }>;
  authenticate(token: string | null): Promise<AccountPublic | null>;
  logout(token: string | null): Promise<void>;
};

function toPublicAccount(record: AccountRecord): AccountPublic {
  return {
    id: record.id,
    displayName: record.displayName,
    username: record.username,
    role: record.role,
    teamId: record.teamId,
    status: record.status,
    updatedAt: record.updatedAt,
  };
}

export function createAuthService(
  repo: AccountRepository,
  options: {
    now?: () => number;
    randomSessionBytes?: () => Uint8Array;
  } = {},
): AuthService {
  const now = options.now ?? Date.now;
  const randomSessionBytes =
    options.randomSessionBytes ??
    (() => crypto.getRandomValues(new Uint8Array(32)));

  return {
    async login(username, password) {
      let normalizedUsername: string | null = null;
      try {
        normalizedUsername = normalizeUsername(username);
      } catch {
        // Invalid username shapes are deliberately handled like unknown users.
      }

      const account = normalizedUsername
        ? await repo.findByNormalizedUsername(normalizedUsername)
        : null;

      if (!account) {
        await verifyPassword(password, DUMMY_PASSWORD);
        throw new AuthError(
          "INVALID_CREDENTIALS",
          "用户名或密码错误",
        );
      }

      if (account.status === "disabled") {
        throw new AuthError(
          "DISABLED",
          "账号已停用，请联系管理员",
        );
      }

      const currentTime = now();
      if (account.lockedUntil && account.lockedUntil > currentTime) {
        const retryAfterSeconds = Math.ceil(
          (account.lockedUntil - currentTime) / 1_000,
        );
        throw new AuthError(
          "LOCKED",
          "登录尝试过多，请稍后再试",
          retryAfterSeconds,
        );
      }

      const passwordMatches = await verifyPassword(password, {
        hash: account.passwordHash,
        salt: account.passwordSalt,
        iterations: account.passwordIterations,
      });

      if (!passwordMatches) {
        const withinWindow =
          account.firstFailedAt !== null &&
          currentTime - account.firstFailedAt <= FAILURE_WINDOW_MS;
        const failedAttemptCount = withinWindow
          ? account.failedAttemptCount + 1
          : 1;
        const firstFailedAt = withinWindow
          ? account.firstFailedAt
          : currentTime;
        const lockedUntil =
          failedAttemptCount >= MAX_FAILED_ATTEMPTS
            ? currentTime + LOCK_DURATION_MS
            : null;

        await repo.updateLoginSecurity(account.id, {
          failedAttemptCount,
          firstFailedAt,
          lockedUntil,
        });

        if (lockedUntil) {
          throw new AuthError(
            "LOCKED",
            "登录尝试过多，请稍后再试",
            Math.ceil(LOCK_DURATION_MS / 1_000),
          );
        }

        throw new AuthError(
          "INVALID_CREDENTIALS",
          "用户名或密码错误",
        );
      }

      await repo.updateLoginSecurity(account.id, {
        failedAttemptCount: 0,
        firstFailedAt: null,
        lockedUntil: null,
      });

      const token = generateSessionToken(randomSessionBytes());
      const tokenHash = await hashSessionToken(token);
      const expiresAt = currentTime + SESSION_TTL_MS;
      await repo.createSession(
        tokenHash,
        account.id,
        currentTime,
        expiresAt,
      );

      return {
        user: toPublicAccount(account),
        token,
        expiresAt,
      };
    },

    async authenticate(token) {
      if (!token) return null;
      const account = await repo.findSessionAccount(
        await hashSessionToken(token),
        now(),
      );
      return account ? toPublicAccount(account) : null;
    },

    async logout(token) {
      if (!token) return;
      await repo.deleteSession(await hashSessionToken(token));
    },
  };
}
