import { afterEach, describe, expect, it, vi } from "vitest";

import { listBackendSubmissions } from "./submissionBackendClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submission backend server client", () => {
  it("forwards the opaque session cookie and returns visible submissions", async () => {
    const submission = {
      id: "SUB-01",
      fileName: "task.mp4",
      ownerId: "U-01",
      ownerName: "测试数采",
      teamId: "TEAM-01",
      teamName: "测试团队",
      sizeBytes: "2048",
      uploadStatus: "uploaded",
      processingStatus: "awaiting_ai",
      isTestData: true,
      createdAt: 1_786_118_400_000,
      segments: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ submissions: [submission] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listBackendSubmissions("opaque-token")).resolves.toEqual([
      submission,
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/submissions",
      {
        cache: "no-store",
        headers: { cookie: "evdp_session=opaque-token" },
      },
    );
  });

  it("returns an empty list for an expired backend session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    await expect(listBackendSubmissions("expired-token")).resolves.toEqual([]);
  });
});
