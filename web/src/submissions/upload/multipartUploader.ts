import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { submissionUploadApi } from "../client/submissionApi";
import type {
  BackendSubmission,
  PresignedPart,
  SubmissionUploadApi,
} from "../contracts";

const DEFAULT_HASH_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CONCURRENT_PARTS = 3;

export async function sha256File(
  file: File,
  chunkSize = DEFAULT_HASH_CHUNK_BYTES,
): Promise<string> {
  const digest = sha256.create();
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const bytes = new Uint8Array(
      await file.slice(offset, offset + chunkSize).arrayBuffer(),
    );
    digest.update(bytes);
  }
  return bytesToHex(digest.digest());
}

function contentType(file: File): "video/mp4" | "video/quicktime" {
  const lower = file.name.toLocaleLowerCase("en-US");
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  throw new Error("仅支持 MOV 和 MP4 视频");
}

async function presignAllParts(
  api: SubmissionUploadApi,
  submissionId: string,
  partCount: number,
): Promise<PresignedPart[]> {
  const result: PresignedPart[] = [];
  for (let start = 1; start <= partCount; start += 50) {
    const partNumbers = Array.from(
      { length: Math.min(50, partCount - start + 1) },
      (_, index) => start + index,
    );
    result.push(...(await api.presignParts(submissionId, partNumbers)));
  }
  return result.sort((left, right) => left.partNumber - right.partNumber);
}

export function createMultipartUploader(
  api: SubmissionUploadApi,
  fetchPart: typeof fetch = fetch,
) {
  return async function upload(
    file: File,
    options: {
      signal?: AbortSignal;
      onProgress?(progress: number): void;
    } = {},
  ): Promise<BackendSubmission> {
    const checksumSha256 = await sha256File(file);
    const created = await api.createUpload({
      fileName: file.name,
      contentType: contentType(file),
      sizeBytes: file.size,
      checksumSha256,
    });
    try {
      const presigned = await presignAllParts(
        api,
        created.submission.id,
        created.upload.partCount,
      );
      const completed: Array<{ partNumber: number; etag: string }> = [];
      let nextIndex = 0;
      let uploadedBytes = 0;
      const worker = async () => {
        while (nextIndex < presigned.length) {
          const part = presigned[nextIndex++];
          if (!part) return;
          const start = (part.partNumber - 1) * created.upload.partSizeBytes;
          const end = Math.min(file.size, start + created.upload.partSizeBytes);
          const response = await fetchPart(part.url, {
            method: "PUT",
            body: file.slice(start, end),
            signal: options.signal,
          });
          if (!response.ok) {
            throw new Error(`第 ${part.partNumber} 个视频分片上传失败`);
          }
          const etag = response.headers.get("etag");
          if (!etag) throw new Error("对象存储未返回分片 ETag");
          completed.push({ partNumber: part.partNumber, etag });
          uploadedBytes += end - start;
          options.onProgress?.(
            Math.min(100, Math.round((uploadedBytes / file.size) * 100)),
          );
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(MAX_CONCURRENT_PARTS, presigned.length) },
          () => worker(),
        ),
      );
      completed.sort((left, right) => left.partNumber - right.partNumber);
      return await api.completeUpload(created.submission.id, completed);
    } catch (error) {
      await api.abortUpload(created.submission.id).catch(() => undefined);
      throw error;
    }
  };
}

export const uploadVideo = createMultipartUploader(submissionUploadApi);
