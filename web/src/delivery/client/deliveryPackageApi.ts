import type {
  BackendDeliveryArchiveDownloadLink,
  BackendDeliveryArchiveFormat,
  BackendDeliveryArchiveTask,
  BackendDeliveryDownloadLinks,
  BackendDeliveryPackage,
  BackendDeliveryPreview,
} from "../contracts";

export class DeliveryPackageApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "DeliveryPackageApiError";
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
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = payload as { code?: unknown; error?: unknown };
    throw new DeliveryPackageApiError(
      response.status,
      typeof error.error === "string" ? error.error : "交付包请求失败",
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

export async function listDeliveryPackages(): Promise<
  BackendDeliveryPackage[]
> {
  const result = await requestJson<{ packages: BackendDeliveryPackage[] }>(
    "/delivery-packages",
  );
  return result.packages;
}

export async function previewDeliveryPackage(): Promise<
  BackendDeliveryPreview
> {
  const result = await requestJson<{ preview: BackendDeliveryPreview }>(
    "/delivery-packages/preview",
  );
  return result.preview;
}

export async function createDeliveryPackage(input: {
  name: string;
}): Promise<BackendDeliveryPackage> {
  const result = await requestJson<{ package: BackendDeliveryPackage }>(
    "/delivery-packages",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.package;
}

export async function getDeliveryDownloadLinks(
  id: string,
): Promise<BackendDeliveryDownloadLinks> {
  return await requestJson<BackendDeliveryDownloadLinks>(
    `/delivery-packages/${encodeURIComponent(id)}/download-links`,
  );
}

export async function listDeliveryArchiveTasks(
  id: string,
): Promise<BackendDeliveryArchiveTask[]> {
  const result = await requestJson<{ tasks: BackendDeliveryArchiveTask[] }>(
    `/delivery-packages/${encodeURIComponent(id)}/archive-tasks`,
  );
  return result.tasks;
}

export async function createDeliveryArchiveTask(
  id: string,
  format: BackendDeliveryArchiveFormat,
): Promise<BackendDeliveryArchiveTask> {
  const result = await requestJson<{ task: BackendDeliveryArchiveTask }>(
    `/delivery-packages/${encodeURIComponent(id)}/archive-tasks`,
    {
      method: "POST",
      body: JSON.stringify({ format }),
    },
  );
  return result.task;
}

export async function getDeliveryArchiveTask(
  id: string,
  taskId: string,
): Promise<BackendDeliveryArchiveTask> {
  const result = await requestJson<{ task: BackendDeliveryArchiveTask }>(
    `/delivery-packages/${encodeURIComponent(id)}/archive-tasks/${encodeURIComponent(taskId)}`,
  );
  return result.task;
}

export async function getDeliveryArchiveDownloadLink(
  id: string,
  taskId: string,
): Promise<BackendDeliveryArchiveDownloadLink> {
  return await requestJson<BackendDeliveryArchiveDownloadLink>(
    `/delivery-packages/${encodeURIComponent(id)}/archive-tasks/${encodeURIComponent(taskId)}/download-link`,
  );
}

export function deliveryManifestUrl(id: string): string {
  return apiUrl(`/delivery-packages/${encodeURIComponent(id)}/manifest.csv`);
}

export function deliveryArchiveUrl(id: string): string {
  return apiUrl(`/delivery-packages/${encodeURIComponent(id)}/archive.tar`);
}

export function deliveryZipArchiveUrl(id: string): string {
  return apiUrl(`/delivery-packages/${encodeURIComponent(id)}/archive.zip`);
}
