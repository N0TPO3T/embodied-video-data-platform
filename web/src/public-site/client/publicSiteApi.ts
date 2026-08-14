import type {
  PublicSiteSnapshot,
  UpdatePublicSiteConfigInput,
} from "../contracts";

export class PublicSiteApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PublicSiteApiError";
  }
}

function apiUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:4000/api/v1";
  return `${base.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
}

async function requestJson<T>(
  path: string,
  failureMessage: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = payload as { error?: unknown; code?: unknown };
    throw new PublicSiteApiError(
      response.status,
      typeof error.error === "string" ? error.error : failureMessage,
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

export async function getPublicSiteSnapshot(): Promise<PublicSiteSnapshot> {
  const payload = await requestJson<{ snapshot: PublicSiteSnapshot }>(
    "/public-site/snapshot",
    "公开快照请求失败",
  );
  return payload.snapshot;
}

export async function publishPublicSiteSnapshot(
  input: UpdatePublicSiteConfigInput,
): Promise<PublicSiteSnapshot> {
  const payload = await requestJson<{ snapshot: PublicSiteSnapshot }>(
    "/public-site/snapshot",
    "公开快照保存失败",
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return payload.snapshot;
}
