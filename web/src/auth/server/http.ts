import type { Role } from "../../domain/types";
import type {
  CreateAccountInput,
  UpdateAccountInput,
} from "../contracts";
import { SESSION_TTL_MS } from "../password";
import {
  AccountServiceError,
  type AccountService,
} from "./accountService";
import {
  AuthError,
  type AuthService,
} from "./authService";

const SESSION_COOKIE = "evdp_session";

type RuntimeServices = {
  auth: AuthService;
  accounts: AccountService;
};

type ServiceLoader<T> = () => T | Promise<T>;
type AccountRouteContext = {
  params: Promise<{ id: string }>;
};

function json(
  value: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), {
    ...init,
    headers,
  });
}

function homePath(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "leader") return "/team";
  return "/collector";
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) {
      return valueParts.join("=") || null;
    }
  }
  return null;
}

function shouldSecureCookie(request: Request): boolean {
  const { hostname } = new URL(request.url);
  return hostname !== "localhost" && hostname !== "127.0.0.1";
}

function sessionCookie(request: Request, token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    shouldSecureCookie(request) ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function clearedSessionCookie(request: Request): string {
  return [
    `${SESSION_COOKIE}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    shouldSecureCookie(request) ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new AuthError("FORBIDDEN", "请求来源无效");
  }
}

async function parseJson(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new AccountServiceError(
      "VALIDATION",
      "请求内容不正确",
    );
  }
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new AccountServiceError(
      "VALIDATION",
      "请求内容不正确",
    );
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value
    : undefined;
}

function createInput(
  body: Record<string, unknown>,
): CreateAccountInput {
  return {
    displayName: stringValue(body.displayName),
    username: stringValue(body.username),
    password: stringValue(body.password),
    role: stringValue(body.role) as Role,
    teamId: optionalString(body.teamId),
  };
}

function updateInput(
  body: Record<string, unknown>,
): UpdateAccountInput {
  return {
    displayName: stringValue(body.displayName),
    username: stringValue(body.username),
    role: stringValue(body.role) as Role,
    teamId: optionalString(body.teamId),
  };
}

async function requireActor(
  request: Request,
  auth: AuthService,
) {
  const actor = await auth.authenticate(
    readCookie(request, SESSION_COOKIE),
  );
  if (!actor) {
    throw new AuthError("UNAUTHENTICATED", "请先登录");
  }
  return actor;
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    const status =
      error.code === "FORBIDDEN" || error.code === "DISABLED"
        ? 403
        : error.code === "LOCKED"
          ? 429
          : 401;
    const headers = new Headers();
    if (error.retryAfterSeconds) {
      headers.set("retry-after", String(error.retryAfterSeconds));
    }
    return json(
      { code: error.code, error: error.message },
      { status, headers },
    );
  }

  if (error instanceof AccountServiceError) {
    const status = {
      VALIDATION: 400,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
    }[error.code];
    return json(
      { code: error.code, error: error.message },
      { status },
    );
  }

  return json(
    { code: "INTERNAL", error: "操作失败，请稍后重试" },
    { status: 500 },
  );
}

async function handled(
  operation: () => Promise<Response>,
): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    return errorResponse(error);
  }
}

export function createLoginHandler(
  getAuthService: ServiceLoader<AuthService>,
) {
  return (request: Request) =>
    handled(async () => {
      assertSameOrigin(request);
      const body = await parseJson(request);
      const auth = await getAuthService();
      const result = await auth.login(
        stringValue(body.username),
        stringValue(body.password),
      );
      return json(
        {
          user: result.user,
          homePath: homePath(result.user.role),
        },
        {
          status: 200,
          headers: {
            "set-cookie": sessionCookie(request, result.token),
          },
        },
      );
    });
}

export function createLogoutHandler(
  getAuthService: ServiceLoader<AuthService>,
) {
  return (request: Request) =>
    handled(async () => {
      assertSameOrigin(request);
      const auth = await getAuthService();
      await auth.logout(readCookie(request, SESSION_COOKIE));
      return new Response(null, {
        status: 204,
        headers: {
          "cache-control": "no-store",
          "set-cookie": clearedSessionCookie(request),
        },
      });
    });
}

export function createSessionHandler(
  getAuthService: ServiceLoader<AuthService>,
) {
  return (request: Request) =>
    handled(async () => {
      const auth = await getAuthService();
      const user = await requireActor(request, auth);
      return json({ user, homePath: homePath(user.role) });
    });
}

export function createAccountsCollectionHandlers(
  getServices: ServiceLoader<RuntimeServices>,
) {
  return {
    GET: (request: Request) =>
      handled(async () => {
        const { auth, accounts } = await getServices();
        const actor = await requireActor(request, auth);
        return json({ accounts: await accounts.listVisible(actor) });
      }),

    POST: (request: Request) =>
      handled(async () => {
        assertSameOrigin(request);
        const body = await parseJson(request);
        const { auth, accounts } = await getServices();
        const actor = await requireActor(request, auth);
        const account = await accounts.create(actor, createInput(body));
        return json({ account }, { status: 201 });
      }),
  };
}

export function createAccountUpdateHandler(
  getServices: ServiceLoader<RuntimeServices>,
) {
  return (request: Request, context: AccountRouteContext) =>
    handled(async () => {
      assertSameOrigin(request);
      const body = await parseJson(request);
      const { auth, accounts } = await getServices();
      const actor = await requireActor(request, auth);
      const { id } = await context.params;
      const account = await accounts.update(
        actor,
        id,
        updateInput(body),
      );
      return json({ account });
    });
}

export function createPasswordResetHandler(
  getServices: ServiceLoader<RuntimeServices>,
) {
  return (request: Request, context: AccountRouteContext) =>
    handled(async () => {
      assertSameOrigin(request);
      const body = await parseJson(request);
      const { auth, accounts } = await getServices();
      const actor = await requireActor(request, auth);
      const { id } = await context.params;
      const result = await accounts.resetPassword(
        actor,
        id,
        stringValue(body.password),
      );
      return json(result, {
        headers: result.reauthenticate
          ? { "set-cookie": clearedSessionCookie(request) }
          : undefined,
      });
    });
}

export function createAccountStatusHandler(
  getServices: ServiceLoader<RuntimeServices>,
) {
  return (request: Request, context: AccountRouteContext) =>
    handled(async () => {
      assertSameOrigin(request);
      const body = await parseJson(request);
      const { auth, accounts } = await getServices();
      const actor = await requireActor(request, auth);
      const { id } = await context.params;
      const account = await accounts.setStatus(
        actor,
        id,
        stringValue(body.status) as "active" | "disabled",
      );
      return json({ account });
    });
}

export function createAccountAuditHandler(
  getServices: ServiceLoader<RuntimeServices>,
) {
  return (request: Request) =>
    handled(async () => {
      const { auth, accounts } = await getServices();
      const actor = await requireActor(request, auth);
      const limit = Number(new URL(request.url).searchParams.get("limit"));
      const logs = await accounts.listAudit(
        actor,
        Number.isFinite(limit) && limit > 0 ? limit : undefined,
      );
      return json({ logs });
    });
}
