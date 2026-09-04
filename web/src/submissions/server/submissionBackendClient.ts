import { resolveApiBaseUrl } from "../../lib/api-base";
import type { BackendSubmission } from "../contracts";

function apiUrl(path: string): string {
  const base = resolveApiBaseUrl(
    process.env.BACKEND_INTERNAL_URL,
    "http://localhost:4000/api/v1",
  );
  return `${base.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
}

export async function listBackendSubmissions(
  sessionToken: string,
): Promise<BackendSubmission[]> {
  const response = await fetch(apiUrl("/submissions"), {
    cache: "no-store",
    headers: { cookie: `evdp_session=${sessionToken}` },
  });
  if (response.status === 401) return [];
  if (!response.ok) {
    throw new Error(`视频后端请求失败（${response.status}）`);
  }
  const result = (await response.json()) as {
    submissions: BackendSubmission[];
  };
  return result.submissions;
}
