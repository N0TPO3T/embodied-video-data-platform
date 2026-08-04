import { validatePassword } from "../validation";

const INVALID_CONFIGURATION = "初始账号密码配置无效";

export function parseInitialAccountPasswords(
  raw: unknown,
  usernames: readonly string[],
): Record<string, string> {
  try {
    if (typeof raw !== "string") throw new Error(INVALID_CONFIGURATION);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(INVALID_CONFIGURATION);
    }

    const values = parsed as Record<string, unknown>;
    const expectedKeys = [...usernames].sort();
    const actualKeys = Object.keys(values).sort();
    if (
      expectedKeys.length !== actualKeys.length ||
      expectedKeys.some((key, index) => key !== actualKeys[index])
    ) {
      throw new Error(INVALID_CONFIGURATION);
    }

    return Object.fromEntries(
      expectedKeys.map((username) => {
        const password = values[username];
        if (typeof password !== "string") {
          throw new Error(INVALID_CONFIGURATION);
        }
        return [username, validatePassword(password)];
      }),
    );
  } catch {
    throw new Error(INVALID_CONFIGURATION);
  }
}
