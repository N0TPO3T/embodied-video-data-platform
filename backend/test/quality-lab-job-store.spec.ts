import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { QualityLabJobStore } from "../src/quality-lab/job-store.js";
import type { NormalizedVideoQcResultV1 } from "../src/video-quality/video-quality.types.js";

const directories: string[] = [];

async function setup(now: () => Date) {
  const directory = await mkdtemp(join(tmpdir(), "quality-lab-store-"));
  directories.push(directory);
  const persistencePath = join(directory, "jobs.json");
  return {
    persistencePath,
    store: new QualityLabJobStore({ persistencePath, now }),
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("quality lab persistent job store", () => {
  it("reloads terminal jobs and their redacted diagnostics", async () => {
    const now = () => new Date("2026-08-12T08:00:00.000Z");
    const { store, persistencePath } = await setup(now);
    const record = store.create({
      batchId: "batch-one",
      fileName: "26018_68.mp4",
      sizeBytes: 123,
      filePath: "/tmp/private-video.mp4",
      workDirectory: "/tmp/private-frames",
    });
    store.appendDiagnostic(record.public.id, {
      taskId: record.public.id,
      modelStage: "flash",
      operation: "analysis",
      model: "qwen3-vl-flash-2026-01-22",
      attempt: 1,
      startedAt: now().toISOString(),
      finishedAt: now().toISOString(),
      durationMs: 18,
      outcome: "network_error",
      httpStatus: null,
      requestId: null,
      retryable: true,
      errorName: "TypeError",
      errorCode: "UND_ERR_CONNECT_TIMEOUT",
      errorMessage: "Bearer sk-ws-secret data:image/jpeg;base64,AAAA /tmp/private",
    });
    store.fail(record.public.id, "百炼网络请求失败");

    const restored = new QualityLabJobStore({ persistencePath, now });
    expect(restored.listPublic()).toHaveLength(1);
    expect(restored.getPublic(record.public.id)).toMatchObject({
      id: record.public.id,
      fileName: "26018_68.mp4",
      stage: "system_failed",
      diagnostics: [
        {
          taskId: record.public.id,
          errorName: "TypeError",
          errorCode: "UND_ERR_CONNECT_TIMEOUT",
        },
      ],
    });
    const persisted = await readFile(persistencePath, "utf8");
    expect(persisted).not.toContain("sk-ws-secret");
    expect(persisted).not.toContain("base64,AAAA");
    expect(persisted).not.toContain("private-video");
  });

  it("marks non-terminal jobs as interrupted after a service restart", async () => {
    const now = () => new Date("2026-08-12T08:00:00.000Z");
    const { store, persistencePath } = await setup(now);
    const record = store.create({
      batchId: "batch-two",
      fileName: "active.mp4",
      sizeBytes: 456,
      filePath: "/tmp/video.mp4",
      workDirectory: "/tmp/work",
    });
    store.updateStage(record.public.id, "flash_review");

    const restored = new QualityLabJobStore({ persistencePath, now });
    expect(restored.getPublic(record.public.id)).toMatchObject({
      stage: "system_failed",
      error: "服务重启导致任务中断，请重新上传",
    });
  });

  it("does not persist the complete raw model response", async () => {
    const now = () => new Date("2026-08-12T08:00:00.000Z");
    const { store, persistencePath } = await setup(now);
    const record = store.create({
      batchId: "safe",
      fileName: "safe.mp4",
      sizeBytes: 1,
      filePath: "/tmp/safe.mp4",
      workDirectory: "/tmp/safe",
    });
    store.complete(
      record.public.id,
      {
        evaluationStatus: "scored",
        finalScore: 88,
        rawModelResult: { secret_raw_response: "must-not-persist" },
      } as unknown as NormalizedVideoQcResultV1,
    );

    const persisted = await readFile(persistencePath, "utf8");
    expect(persisted).toContain('"finalScore": 88');
    expect(persisted).not.toContain("rawModelResult");
    expect(persisted).not.toContain("must-not-persist");
  });

  it("removes terminal history older than 30 days and supports manual deletion", async () => {
    let current = new Date("2026-07-01T00:00:00.000Z");
    const now = () => current;
    const { store } = await setup(now);
    const old = store.create({
      batchId: "old",
      fileName: "old.mp4",
      sizeBytes: 1,
      filePath: "/tmp/old.mp4",
      workDirectory: "/tmp/old",
    });
    store.fail(old.public.id, "old");
    current = new Date("2026-08-01T00:00:00.001Z");
    expect(store.listPublic()).toEqual([]);

    const recent = store.create({
      batchId: "recent",
      fileName: "recent.mp4",
      sizeBytes: 1,
      filePath: "/tmp/recent.mp4",
      workDirectory: "/tmp/recent",
    });
    store.fail(recent.public.id, "recent");
    expect(store.deleteTerminal(recent.public.id)).toBe(true);
    expect(store.getPublic(recent.public.id)).toBeUndefined();
  });
});
