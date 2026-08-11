import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  BackendSubmission,
  CreateUploadResult,
  SubmissionUploadApi,
} from "../contracts";
import {
  createMultipartUploader,
  sha256File,
} from "./multipartUploader";

const queuedSubmission: BackendSubmission = {
  id: "SUB-UPLOAD",
  fileName: "task.mp4",
  ownerId: "U-COLLECTOR",
  ownerName: "测试数采",
  teamId: "TEAM-01",
  teamName: "测试团队",
  sizeBytes: "10",
  uploadStatus: "uploaded",
  processingStatus: "queued",
  isTestData: false,
  createdAt: 1_786_118_400_000,
  segments: [],
};

describe("browser multipart uploader", () => {
  it("hashes a file incrementally to the standard SHA-256 value", async () => {
    const bytes = "local-video-bytes";
    const expected = createHash("sha256").update(bytes).digest("hex");

    await expect(
      sha256File(new File([bytes], "task.mp4", { type: "video/mp4" }), 4),
    ).resolves.toBe(expected);
  });

  it("uploads no more than three parts concurrently and completes in order", async () => {
    const completed: Array<{ partNumber: number; etag: string }> = [];
    const api: SubmissionUploadApi = {
      async createUpload(): Promise<CreateUploadResult> {
        return {
          submission: { ...queuedSubmission, uploadStatus: "uploading", processingStatus: "uploading" },
          upload: {
            uploadId: "UPLOAD-01",
            partSizeBytes: 2,
            partCount: 5,
            expiresInSeconds: 900,
          },
        };
      },
      async presignParts(_id, partNumbers) {
        return partNumbers.map((partNumber) => ({
          partNumber,
          url: `http://minio.local/part-${partNumber}`,
          expiresAt: 1_786_118_400_000,
        }));
      },
      async completeUpload(_id, parts) {
        completed.push(...parts);
        return queuedSubmission;
      },
      async abortUpload() {},
    };
    let active = 0;
    let maximumActive = 0;
    const uploadedParts: number[] = [];
    const fetchPart: typeof fetch = async (input) => {
      const partNumber = Number(String(input).split("-").at(-1));
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      uploadedParts.push(partNumber);
      active -= 1;
      return new Response(null, {
        status: 200,
        headers: { etag: `etag-${partNumber}` },
      });
    };
    const progress: number[] = [];
    const uploader = createMultipartUploader(api, fetchPart);

    await expect(
      uploader(
        new File(["abcdefghij"], "task.mp4", { type: "video/mp4" }),
        { onProgress: (value) => progress.push(value) },
      ),
    ).resolves.toEqual(queuedSubmission);

    expect(maximumActive).toBe(3);
    expect(uploadedParts.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(completed).toEqual([
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
      { partNumber: 3, etag: "etag-3" },
      { partNumber: 4, etag: "etag-4" },
      { partNumber: 5, etag: "etag-5" },
    ]);
    expect(progress.at(-1)).toBe(100);
  });
});
