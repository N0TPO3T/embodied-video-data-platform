import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import type { DataSource } from "typeorm";

import { createDataSource } from "../src/database/data-source.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "../src/database/entities/media-segment.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import type {
  MediaCommandResult,
  MediaCommandRunner,
} from "../src/media/media-command-runner.js";
import { MediaAnalysisService } from "../src/media/media-analysis.service.js";
import type { ObjectStoragePort } from "../src/storage/object-storage.port.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const VIDEO_BYTES = Buffer.from("test-video-binary-content", "utf8");

class DownloadingStorage implements ObjectStoragePort {
  async downloadObject(input: {
    objectKey: string;
    destinationPath: string;
  }): Promise<void> {
    void input.objectKey;
    await writeFile(input.destinationPath, VIDEO_BYTES);
  }

  async createMultipartUpload(): Promise<never> {
    throw new Error("not used");
  }
  async presignUploadPart(): Promise<never> {
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
}

describe("media analysis service", () => {
  let dataSource: DataSource;
  let runner: RecordingRunner;
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
    service = new MediaAnalysisService(
      dataSource,
      dataSource.getRepository(SubmissionEntity),
      new DownloadingStorage(),
      runner,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("verifies the object and replaces metadata and intervals idempotently", async () => {
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
    });
    expect(
      await dataSource.getRepository(MediaSegmentEntity).countBy({
        submissionId,
      }),
    ).toBe(2);

    runner.result.segments = [
      { type: "black", startSeconds: 10, endSeconds: 12 },
    ];
    await service.process({ submissionId });
    const segments = await dataSource
      .getRepository(MediaSegmentEntity)
      .findBy({ submissionId });
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      type: "black",
      startSeconds: "10.000",
      endSeconds: "12.000",
    });
    expect(runner.calls).toBe(2);
  });
});
