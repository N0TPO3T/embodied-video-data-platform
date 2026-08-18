import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

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

const authorization = {
  dataUsageAuthorized: true,
  privacyConfirmed: true,
  sensitiveContentConfirmed: true,
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
      async verifyResumeUpload(): Promise<CreateUploadResult> {
        throw new Error("not used");
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
        {
          authorization,
          onProgress: (value) => progress.push(value),
        },
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

  it("resumes an active upload without creating a new backend task", async () => {
    const calls: {
      create: number;
      abort: number;
      verify?: { fileName: string; sizeBytes: number; checksumSha256: string };
    } = { create: 0, abort: 0 };
    const completed: Array<{ partNumber: number; etag: string }> = [];
    const api: SubmissionUploadApi = {
      async createUpload(): Promise<CreateUploadResult> {
        calls.create += 1;
        throw new Error("should not create");
      },
      async presignParts(_id, partNumbers) {
        return partNumbers.map((partNumber) => ({
          partNumber,
          url: `http://minio.local/resume-${partNumber}`,
          expiresAt: 1_786_118_400_000,
        }));
      },
      async verifyResumeUpload(_id, input): Promise<CreateUploadResult> {
        calls.verify = input;
        return {
          submission: { ...queuedSubmission, uploadStatus: "uploading", processingStatus: "uploading" },
          upload: {
            uploadId: "UPLOAD-EXISTING",
            partSizeBytes: 5,
            partCount: 2,
            expiresInSeconds: 900,
          },
        };
      },
      async completeUpload(_id, parts) {
        completed.push(...parts);
        return queuedSubmission;
      },
      async abortUpload() {
        calls.abort += 1;
      },
    };
    const fetchPart: typeof fetch = async (input) => {
      const partNumber = Number(String(input).split("-").at(-1));
      return new Response(null, {
        status: 200,
        headers: { etag: `etag-${partNumber}` },
      });
    };
    const uploader = createMultipartUploader(api, fetchPart);

    await expect(
      uploader.resume(
        new File(["abcdefghij"], "task.mp4", { type: "video/mp4" }),
        {
          submission: { ...queuedSubmission, uploadStatus: "uploading", processingStatus: "uploading" },
          upload: {
            uploadId: "UPLOAD-EXISTING",
            partSizeBytes: 5,
            partCount: 2,
            expiresInSeconds: 900,
          },
        },
      ),
    ).resolves.toEqual(queuedSubmission);

    expect(calls).toEqual({
      create: 0,
      abort: 0,
      verify: {
        fileName: "task.mp4",
        sizeBytes: 10,
        checksumSha256: createHash("sha256").update("abcdefghij").digest("hex"),
      },
    });
    expect(completed).toEqual([
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
    ]);
  });

  it("does not abort the backend session when the browser upload is paused", async () => {
    const calls = { abort: 0 };
    const api: SubmissionUploadApi = {
      async createUpload(): Promise<CreateUploadResult> {
        return {
          submission: { ...queuedSubmission, uploadStatus: "uploading", processingStatus: "uploading" },
          upload: {
            uploadId: "UPLOAD-PAUSE",
            partSizeBytes: 5,
            partCount: 2,
            expiresInSeconds: 900,
          },
        };
      },
      async presignParts(_id, partNumbers) {
        return partNumbers.map((partNumber) => ({
          partNumber,
          url: `http://minio.local/pause-${partNumber}`,
          expiresAt: 1_786_118_400_000,
        }));
      },
      async verifyResumeUpload(): Promise<CreateUploadResult> {
        throw new Error("not used");
      },
      async completeUpload() {
        return queuedSubmission;
      },
      async abortUpload() {
        calls.abort += 1;
      },
    };
    const controller = new AbortController();
    const fetchPart: typeof fetch = async (_input, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Paused", "AbortError"));
        });
        controller.abort();
      });
    };
    const uploader = createMultipartUploader(api, fetchPart);

    await expect(
      uploader(new File(["abcdefghij"], "task.mp4", { type: "video/mp4" }), {
        authorization,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.abort).toBe(0);
  });

  it("requires explicit data authorization before creating an upload", async () => {
    const api: SubmissionUploadApi = {
      async createUpload(): Promise<CreateUploadResult> {
        throw new Error("should not create");
      },
      async presignParts() {
        return [];
      },
      async verifyResumeUpload(): Promise<CreateUploadResult> {
        throw new Error("not used");
      },
      async completeUpload() {
        return queuedSubmission;
      },
      async abortUpload() {},
    };
    const uploader = createMultipartUploader(api);

    await expect(
      uploader(new File(["abc"], "task.mp4", { type: "video/mp4" })),
    ).rejects.toThrow("上传前请先确认数据授权、隐私规范和敏感内容处理要求");
  });

  it("rejects oversized files before hashing or creating an upload", async () => {
    const createUpload = vi.fn<SubmissionUploadApi["createUpload"]>();
    const api: SubmissionUploadApi = {
      createUpload,
      async presignParts() {
        return [];
      },
      async verifyResumeUpload(): Promise<CreateUploadResult> {
        throw new Error("not used");
      },
      async completeUpload() {
        return queuedSubmission;
      },
      async abortUpload() {},
    };
    const oversized = new File(["video"], "oversized.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(oversized, "size", { value: 2 * 1024 ** 3 + 1 });

    await expect(
      createMultipartUploader(api)(oversized, { authorization }),
    ).rejects.toThrow("单个视频不能超过 2 GiB");
    expect(createUpload).not.toHaveBeenCalled();
  });
});
