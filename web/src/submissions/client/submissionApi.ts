import type {
  BackendSubmission,
  CreateUploadResult,
  PresignedPart,
  SubmissionUploadApi,
} from "../contracts";

export class SubmissionApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SubmissionApiError";
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
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers,
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const error = payload as { code?: unknown; error?: unknown };
    throw new SubmissionApiError(
      response.status,
      typeof error.error === "string" ? error.error : "视频请求失败",
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

export const submissionUploadApi: SubmissionUploadApi = {
  createUpload(input) {
    return requestJson<CreateUploadResult>("/submissions/uploads", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async presignParts(id, partNumbers) {
    const result = await requestJson<{ parts: PresignedPart[] }>(
      `/submissions/${encodeURIComponent(id)}/uploads/parts`,
      {
        method: "POST",
        body: JSON.stringify({ partNumbers }),
      },
    );
    return result.parts.map((part) => ({
      ...part,
      expiresAt:
        typeof part.expiresAt === "number"
          ? part.expiresAt
          : Date.parse(String(part.expiresAt)),
    }));
  },

  async completeUpload(id, parts) {
    const result = await requestJson<{ submission: BackendSubmission }>(
      `/submissions/${encodeURIComponent(id)}/uploads/complete`,
      {
        method: "POST",
        body: JSON.stringify({ parts }),
      },
    );
    return result.submission;
  },

  abortUpload(id) {
    return requestJson<void>(
      `/submissions/${encodeURIComponent(id)}/uploads`,
      { method: "DELETE" },
    );
  },
};

export async function listSubmissions(): Promise<BackendSubmission[]> {
  const result = await requestJson<{ submissions: BackendSubmission[] }>(
    "/submissions",
  );
  return result.submissions;
}

export async function getSubmission(id: string): Promise<BackendSubmission> {
  const result = await requestJson<{ submission: BackendSubmission }>(
    `/submissions/${encodeURIComponent(id)}`,
  );
  return result.submission;
}
