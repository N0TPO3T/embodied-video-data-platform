import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import type { DataSource } from "typeorm";

import { createDataSource } from "../src/database/data-source.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "../src/database/entities/media-segment.entity.js";
import { JobOutboxEntity } from "../src/database/entities/job-outbox.entity.js";
import { SubmissionDuplicateCandidateEntity } from "../src/database/entities/submission-duplicate-candidate.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { VideoQualityPromptVersionEntity } from "../src/database/entities/video-quality-prompt-version.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";
import type {
  MediaCommandResult,
  MediaCommandRunner,
} from "../src/media/media-command-runner.js";
import {
  MediaAnalysisService,
  RetryableMediaError,
} from "../src/media/media-analysis.service.js";
import type { ObjectStoragePort } from "../src/storage/object-storage.port.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const VIDEO_BYTES = Buffer.from("test-video-binary-content", "utf8");

class DownloadingStorage implements ObjectStoragePort {
  uploaded: Array<{ objectKey: string; sourcePath: string; contentType: string }> =
    [];

  async downloadObject(input: {
    objectKey: string;
    destinationPath: string;
  }): Promise<void> {
    void input.objectKey;
    await writeFile(input.destinationPath, VIDEO_BYTES);
  }

  async readObject(): Promise<never> {
    throw new Error("not used");
  }

  async uploadObject(input: {
    objectKey: string;
    sourcePath: string;
    contentType: string;
  }): Promise<void> {
    this.uploaded.push(input);
  }

  async createMultipartUpload(): Promise<never> {
    throw new Error("not used");
  }
  async presignUploadPart(): Promise<never> {
    throw new Error("not used");
  }
  async presignDownloadObject(): Promise<never> {
    throw new Error("not used");
  }
  async deleteObject(): Promise<never> {
    throw new Error("not used");
  }
  async completeMultipartUpload(): Promise<never> {
    throw new Error("not used");
  }
  async headObject(): Promise<never> {
    throw new Error("not used");
  }
  async abortMultipartUpload(): Promise<never> {
    throw new Error("not used");
  }
}

class RecordingRunner implements MediaCommandRunner {
  calls = 0;
  frameCaptures: Array<{ timestampSeconds: number; outputPath: string }> = [];
  previewTranscodes: string[] = [];
  hlsTranscodes: string[] = [];
  result: MediaCommandResult = {
    metadata: {
      durationSeconds: 120,
      width: 1920,
      height: 1080,
      frameRate: 60,
      codec: "h264",
      bitrate: 8_000_000,
      sizeBytes: VIDEO_BYTES.length,
      rawProbe: { format: { duration: "120" } },
    },
    segments: [
      { type: "black", startSeconds: 0, endSeconds: 2 },
      { type: "freeze", startSeconds: 30, endSeconds: 35 },
    ],
  };

  async analyze(): Promise<MediaCommandResult> {
    this.calls += 1;
    return structuredClone(this.result);
  }

  async captureFrame(input: {
    timestampSeconds: number;
    outputPath: string;
  }): Promise<void> {
    this.frameCaptures.push(input);
    await writeFile(input.outputPath, Buffer.from("jpeg", "utf8"));
  }

  async transcodePreview(input: { outputPath: string }): Promise<void> {
    this.previewTranscodes.push(input.outputPath);
    await writeFile(input.outputPath, Buffer.from("mp4", "utf8"));
  }

  async transcodeHls(input: { outputDirectory: string }) {
    this.hlsTranscodes.push(input.outputDirectory);
    await writeFile(
      `${input.outputDirectory}/master.m3u8`,
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720p.m3u8\n",
    );
    await writeFile(
      `${input.outputDirectory}/720p.m3u8`,
      "#EXTM3U\n#EXTINF:4.000,\n720p-000.ts\n",
    );
    await writeFile(`${input.outputDirectory}/720p-000.ts`, "segment");
    return [{ quality: "720p", width: 1280, height: 720 }];
  }
}

class BlockingRunner extends RecordingRunner {
  readonly firstStarted: Promise<void>;
  private resolveFirstStarted: () => void = () => undefined;
  private releaseFirst: () => void = () => undefined;
  private readonly firstRelease: Promise<void>;

  constructor() {
    super();
    this.firstStarted = new Promise((resolve) => {
      this.resolveFirstStarted = resolve;
    });
    this.firstRelease = new Promise((resolve) => {
      this.releaseFirst = resolve;
    });
  }

  override async analyze(): Promise<MediaCommandResult> {
    this.calls += 1;
    if (this.calls === 1) {
      this.resolveFirstStarted();
      await this.firstRelease;
    }
    return structuredClone(this.result);
  }

  release(): void {
    this.releaseFirst();
  }
}

class TimeoutOnceRunner extends RecordingRunner {
  override async analyze(): Promise<MediaCommandResult> {
    this.calls += 1;
    if (this.calls === 1) {
      throw new Error("ffmpeg timed out after 20 ms");
    }
    return structuredClone(this.result);
  }
}

describe("media analysis service", () => {
  let dataSource: DataSource;
  let runner: RecordingRunner;
  let storage: DownloadingStorage;
  let service: MediaAnalysisService;
  let submissionId: string;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-MEDIA",
      name: "媒体测试团队",
    });
    await dataSource.getRepository(UserEntity).save({
      id: "U-MEDIA",
      displayName: "媒体测试数采",
      username: "media-test",
      usernameNormalized: "media-test",
      passwordHash: "argon-hash",
      role: "collector",
      teamId: "TEAM-MEDIA",
      status: "active",
    });
    await dataSource.getRepository(SubmissionEntity).save({
      id: "SUB-MEDIA-EXISTING",
      ownerId: "U-MEDIA",
      teamId: "TEAM-MEDIA",
      originalFileName: "same-shape-before.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: String(VIDEO_BYTES.length),
      checksumSha256: "9".repeat(64),
      objectKey: "uploads/existing/original.mp4",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      isTestData: false,
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: "SUB-MEDIA-EXISTING",
      durationSeconds: "118.000",
      width: 1920,
      height: 1080,
      frameRate: "60.000",
      codec: "h264",
      bitrate: "8000000",
      sizeBytes: String(VIDEO_BYTES.length),
      rawProbe: {},
    });
    await dataSource.getRepository(VideoQualityPromptVersionEntity).save({
      id: "PROMPT-MEDIA",
      revision: 1,
      systemPrompt: "media idempotency test prompt",
      contentSha256: "a".repeat(64),
      promptVersion: "media-test-v1",
      ruleVersion: "media-test-v1",
      outputSchema: "video_qc_result_v1",
      initialModel: "test-initial",
      reviewModel: "test-review",
      active: false,
      createdByAccountId: "U-MEDIA",
      createdByName: "媒体测试数采",
    });
  });

  beforeEach(async () => {
    submissionId = `SUB-${randomUUID()}`;
    await dataSource.getRepository(SubmissionEntity).save({
      id: submissionId,
      ownerId: "U-MEDIA",
      teamId: "TEAM-MEDIA",
      originalFileName: "real-shape.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: String(VIDEO_BYTES.length),
      checksumSha256: createHash("sha256")
        .update(VIDEO_BYTES)
        .digest("hex"),
      objectKey: `uploads/${submissionId}/original.mp4`,
      uploadStatus: "uploaded",
      processingStatus: "queued",
      isTestData: false,
      uploadedAt: new Date(),
    });
    runner = new RecordingRunner();
    storage = new DownloadingStorage();
    service = new MediaAnalysisService(
      dataSource,
      dataSource.getRepository(SubmissionEntity),
      storage,
      runner,
    );
  });

  afterEach(async () => {
    await dataSource.getRepository(JobOutboxEntity).delete({
      aggregateId: submissionId,
    });
    await dataSource.getRepository(SubmissionEntity).delete({ id: submissionId });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("verifies the object and ignores a duplicate delivery after media commit", async () => {
    await service.process({ submissionId });

    const submission = await dataSource
      .getRepository(SubmissionEntity)
      .findOneByOrFail({ id: submissionId });
    expect(submission.processingStatus).toBe("awaiting_ai");
    expect(
      await dataSource.getRepository(MediaMetadataEntity).findOneByOrFail({
        submissionId,
      }),
    ).toMatchObject({
      durationSeconds: "120.000",
      frameRate: "60.000",
      codec: "h264",
      thumbnailObjectKey: `derived/${submissionId}/preview/thumbnail.jpg`,
      previewObjectKey: `derived/${submissionId}/preview/preview.mp4`,
      hlsMasterObjectKey: `derived/${submissionId}/preview/hls/master.m3u8`,
      hlsBaseObjectKey: `derived/${submissionId}/preview/hls`,
      hlsQualities: [{ quality: "720p", width: 1280, height: 720 }],
    });
    const firstSegments = await dataSource
      .getRepository(MediaSegmentEntity)
      .find({
        where: { submissionId },
        order: { startSeconds: "ASC" },
      });
    expect(firstSegments).toHaveLength(2);
    expect(firstSegments[0]?.evidenceObjectKey).toContain(
      `/segments/1-black.jpg`,
    );
    expect(storage.uploaded.map((item) => item.objectKey)).toEqual(
      expect.arrayContaining([
        `derived/${submissionId}/preview/thumbnail.jpg`,
        `derived/${submissionId}/preview/preview.mp4`,
        `derived/${submissionId}/preview/hls/master.m3u8`,
        `derived/${submissionId}/preview/hls/720p.m3u8`,
        `derived/${submissionId}/preview/hls/720p-000.ts`,
        `derived/${submissionId}/preview/segments/1-black.jpg`,
        `derived/${submissionId}/preview/segments/2-freeze.jpg`,
      ]),
    );
    expect(runner.previewTranscodes).toHaveLength(1);
    expect(runner.hlsTranscodes).toHaveLength(1);
    expect(runner.frameCaptures.map((item) => item.timestampSeconds)).toEqual([
      3,
      1,
      32.5,
    ]);
    expect(
      await dataSource.getRepository(JobOutboxEntity).findOneByOrFail({
        aggregateId: submissionId,
        eventType: "ai.quality.v1",
      }),
    ).toMatchObject({
      status: "pending",
      payload: { submissionId },
    });
    const duplicateCandidate = await dataSource
      .getRepository(SubmissionDuplicateCandidateEntity)
      .findOneByOrFail({ submissionId });
    expect(duplicateCandidate).toMatchObject({
      candidateSubmissionId: "SUB-MEDIA-EXISTING",
      status: "candidate",
    });
    expect(Number(duplicateCandidate.similarity)).toBeGreaterThanOrEqual(0.94);

    runner.result.segments = [
      { type: "black", startSeconds: 10, endSeconds: 12 },
    ];
    await service.process({ submissionId });
    const segments = await dataSource
      .getRepository(MediaSegmentEntity)
      .findBy({ submissionId });
    expect(segments).toHaveLength(2);
    expect(runner.calls).toBe(1);
    expect(
      await dataSource.getRepository(JobOutboxEntity).countBy({
        aggregateId: submissionId,
        eventType: "ai.quality.v1",
      }),
    ).toBe(1);
  });

  it("keeps a terminal AI result and published outbox terminal on an old media message", async () => {
    await service.process({ submissionId });
    const publishedAt = new Date();
    await dataSource.getRepository(JobOutboxEntity).update(
      { aggregateId: submissionId, eventType: "ai.quality.v1" },
      {
        status: "published",
        attempts: 1,
        publishedAt,
      },
    );
    await dataSource.getRepository(VideoQualityResultEntity).save({
      submissionId,
      status: "scored",
      attempts: 1,
      promptVersionId: "PROMPT-MEDIA",
      promptRevision: 1,
      promptContentSha256: "a".repeat(64),
      systemPromptSnapshot: "media idempotency test prompt",
      initialModel: "test-initial",
      reviewModel: "test-review",
      finalScore: "90.0",
      rawTotalScore: "90.0",
      settlementRatio: "1.0000",
      invalidDurationMs: "0",
      billableDurationMs: "120000",
      completedAt: new Date(),
    });
    await dataSource.getRepository(SubmissionEntity).update(
      { id: submissionId },
      { processingStatus: "completed" },
    );

    await service.process({ submissionId });

    await expect(
      dataSource.getRepository(SubmissionEntity).findOneByOrFail({
        id: submissionId,
      }),
    ).resolves.toMatchObject({ processingStatus: "completed" });
    await expect(
      dataSource.getRepository(VideoQualityResultEntity).findOneByOrFail({
        submissionId,
      }),
    ).resolves.toMatchObject({ status: "scored", finalScore: "90.0" });
    await expect(
      dataSource.getRepository(JobOutboxEntity).findOneByOrFail({
        aggregateId: submissionId,
        eventType: "ai.quality.v1",
      }),
    ).resolves.toMatchObject({
      status: "published",
      attempts: 1,
      publishedAt,
    });
    expect(runner.calls).toBe(1);
  });

  it("keeps a reclaimed delivery retryable while the old media run holds the lock", async () => {
    const blockingRunner = new BlockingRunner();
    const concurrentService = new MediaAnalysisService(
      dataSource,
      dataSource.getRepository(SubmissionEntity),
      storage,
      blockingRunner,
    );
    const first = concurrentService.process({ submissionId });
    await blockingRunner.firstStarted;
    await dataSource.getRepository(SubmissionEntity).update(
      { id: submissionId },
      {
        processingStatus: "queued",
        failureCode: "WORKER_TIMEOUT_RECLAIMED",
        failureMessage: "后台任务运行超时，已重新排队",
      },
    );
    const second = concurrentService.process({ submissionId });
    let callsWhileFirstWasRunning = 0;
    let outcomes: Awaited<ReturnType<MediaAnalysisService["process"]>>[] = [];
    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      callsWhileFirstWasRunning = blockingRunner.calls;
    } finally {
      blockingRunner.release();
      outcomes = await Promise.all([first, second]);
    }

    expect(callsWhileFirstWasRunning).toBe(1);
    expect(outcomes).toEqual(["skipped", "lock_busy"]);
    expect(blockingRunner.calls).toBe(1);
    await expect(
      concurrentService.process({ submissionId }),
    ).resolves.toBe("processed");
    expect(blockingRunner.calls).toBe(2);
    await expect(
      dataSource.getRepository(SubmissionEntity).findOneByOrFail({
        id: submissionId,
      }),
    ).resolves.toMatchObject({ processingStatus: "awaiting_ai" });
    expect(
      await dataSource.getRepository(JobOutboxEntity).countBy({
        aggregateId: submissionId,
        eventType: "ai.quality.v1",
      }),
    ).toBe(1);
  });

  it("releases the lock and retries after a media command timeout", async () => {
    const timeoutRunner = new TimeoutOnceRunner();
    const retryService = new MediaAnalysisService(
      dataSource,
      dataSource.getRepository(SubmissionEntity),
      storage,
      timeoutRunner,
    );

    await expect(
      retryService.process({ submissionId }),
    ).rejects.toBeInstanceOf(RetryableMediaError);
    await expect(
      dataSource.getRepository(SubmissionEntity).findOneByOrFail({
        id: submissionId,
      }),
    ).resolves.toMatchObject({
      processingStatus: "system_failed",
      failureCode: "MEDIA_PROCESSING_FAILED",
      failureMessage: "ffmpeg timed out after 20 ms",
    });

    await expect(
      retryService.process({ submissionId }),
    ).resolves.toBe("processed");
    expect(timeoutRunner.calls).toBe(2);
    await expect(
      dataSource.getRepository(SubmissionEntity).findOneByOrFail({
        id: submissionId,
      }),
    ).resolves.toMatchObject({ processingStatus: "awaiting_ai" });
  });
});
