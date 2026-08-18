import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackendSubmission } from "../contracts";
import {
  getSubmissionPreview,
  loadAllSubmissions,
  submissionUploadApi,
  submissionsExportUrl,
} from "./submissionApi";

describe("submission API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes HLS preview paths to the configured backend origin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          preview: {
            url: "http://minio.local/preview.mp4",
            expiresAt: Date.now() + 600_000,
            contentType: "video/mp4",
            fileName: "task.mp4",
            hls: {
              url: "/api/v1/submissions/SUB-001/preview/hls/master.m3u8",
              contentType: "application/vnd.apple.mpegurl",
              qualities: [{ quality: "720p", width: 1280, height: 720 }],
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(getSubmissionPreview("SUB-001")).resolves.toMatchObject({
      hls: {
        url: "http://localhost:4000/api/v1/submissions/SUB-001/preview/hls/master.m3u8",
      },
    });
  });

  it("shows validation details instead of the generic Bad Request label", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 400,
          error: "Bad Request",
          message: ["单个视频不能超过 2 GiB"],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      submissionUploadApi.createUpload({
        fileName: "oversized.mp4",
        contentType: "video/mp4",
        sizeBytes: 2 * 1024 ** 3 + 1,
        checksumSha256: "a".repeat(64),
        dataUsageAuthorized: true,
        privacyConfirmed: true,
        sensitiveContentConfirmed: true,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "单个视频不能超过 2 GiB",
    });
  });

  it("builds CSV export URLs from the current submission filters", () => {
    expect(
      submissionsExportUrl({
        q: " first-person ",
        status: "passed",
        page: 2,
        pageSize: 20,
      }),
    ).toBe(
      "http://localhost:4000/api/v1/submissions/export.csv?q=first-person&status=passed",
    );
    expect(submissionsExportUrl({ status: "all" })).toBe(
      "http://localhost:4000/api/v1/submissions/export.csv",
    );
  });

  it("loads every submission across multiple 100-item pages", async () => {
    const submissions = Array.from(
      { length: 205 },
      (_, index) => ({ id: `SUB-${String(index + 1).padStart(3, "0")}` }) as BackendSubmission,
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input));
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("pageSize"));
        const start = (page - 1) * pageSize;
        return new Response(
          JSON.stringify({
            submissions: submissions.slice(start, start + pageSize),
            pagination: {
              page,
              pageSize,
              total: submissions.length,
              totalPages: Math.ceil(submissions.length / pageSize),
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

    await expect(loadAllSubmissions({ status: "all" })).resolves.toEqual(
      submissions,
    );
    expect(
      fetchMock.mock.calls.map(([input]) => {
        const url = new URL(String(input));
        return {
          page: url.searchParams.get("page"),
          pageSize: url.searchParams.get("pageSize"),
          status: url.searchParams.get("status"),
        };
      }),
    ).toEqual([
      { page: "1", pageSize: "100", status: null },
      { page: "2", pageSize: "100", status: null },
      { page: "3", pageSize: "100", status: null },
    ]);
  });

  it("fails explicitly instead of truncating above the browser safety limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          submissions: [],
          pagination: {
            page: 1,
            pageSize: 100,
            total: 50_001,
            totalPages: 501,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(loadAllSubmissions({ status: "all" })).rejects.toMatchObject({
      status: 413,
      code: "FULL_LIST_LIMIT_EXCEEDED",
    });
  });
});
