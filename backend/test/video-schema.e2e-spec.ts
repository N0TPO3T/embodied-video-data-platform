import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import { createDataSource } from "../src/database/data-source.js";
import { JobOutboxEntity } from "../src/database/entities/job-outbox.entity.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "../src/database/entities/media-segment.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

describe("video ingestion database schema", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-VIDEO",
      name: "视频测试团队",
    });
    await dataSource.getRepository(UserEntity).save({
      id: "U-VIDEO",
      displayName: "视频测试数采",
      username: "video-test",
      usernameNormalized: "video-test",
      passwordHash: "argon-hash",
      role: "collector",
      teamId: "TEAM-VIDEO",
      status: "active",
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("stores one submission with trusted media metadata and intervals", async () => {
    const submissions = dataSource.getRepository(SubmissionEntity);
    const metadata = dataSource.getRepository(MediaMetadataEntity);
    const segments = dataSource.getRepository(MediaSegmentEntity);
    const id = `SUB-${randomUUID()}`;

    await submissions.save({
      id,
      ownerId: "U-VIDEO",
      teamId: "TEAM-VIDEO",
      originalFileName: "test-video.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "1048576",
      checksumSha256: "a".repeat(64),
      objectKey: `uploads/${id}/original.mp4`,
      multipartUploadId: "minio-upload-id",
      uploadStatus: "uploading",
      processingStatus: "uploading",
      isTestData: true,
    });
    await metadata.save({
      submissionId: id,
      durationSeconds: "1814.125",
      width: 1920,
      height: 1080,
      frameRate: "59.940",
      codec: "h264",
      bitrate: "12000000",
      sizeBytes: "1048576",
      rawProbe: { format: { format_name: "mov,mp4" } },
    });
    await segments.save([
      {
        id: `SEG-${randomUUID()}`,
        submissionId: id,
        type: "black",
        startSeconds: "0.000",
        endSeconds: "2.500",
        invalid: true,
        details: { source: "ffmpeg" },
      },
      {
        id: `SEG-${randomUUID()}`,
        submissionId: id,
        type: "freeze",
        startSeconds: "90.000",
        endSeconds: "94.250",
        invalid: true,
        details: { source: "ffmpeg" },
      },
    ]);

    expect(
      await metadata.findOneByOrFail({ submissionId: id }),
    ).toMatchObject({
      durationSeconds: "1814.125",
      frameRate: "59.940",
      sizeBytes: "1048576",
    });
    expect(await segments.countBy({ submissionId: id })).toBe(2);
  });

  it("enforces state values, checksum shape, and one media event", async () => {
    const submissions = dataSource.getRepository(SubmissionEntity);
    const outbox = dataSource.getRepository(JobOutboxEntity);
    const id = `SUB-${randomUUID()}`;
    await submissions.save({
      id,
      ownerId: "U-VIDEO",
      teamId: "TEAM-VIDEO",
      originalFileName: "valid.mov",
      contentType: "video/quicktime",
      expectedSizeBytes: "2048",
      checksumSha256: "b".repeat(64),
      objectKey: `uploads/${id}/original.mov`,
      uploadStatus: "uploaded",
      processingStatus: "queued",
      isTestData: false,
    });
    await outbox.save({
      id: `JOB-${randomUUID()}`,
      aggregateType: "submission",
      aggregateId: id,
      eventType: "media.probe.v1",
      payload: { submissionId: id },
      status: "pending",
      attempts: 0,
      availableAt: new Date(),
    });

    await expect(
      outbox.save({
        id: `JOB-${randomUUID()}`,
        aggregateType: "submission",
        aggregateId: id,
        eventType: "media.probe.v1",
        payload: { submissionId: id },
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
      }),
    ).rejects.toThrow();
    await expect(
      dataSource.query(
        `INSERT INTO submissions (
          id, owner_id, team_id, original_file_name, content_type,
          expected_size_bytes, checksum_sha256, object_key,
          upload_status, processing_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          `SUB-${randomUUID()}`,
          "U-VIDEO",
          "TEAM-VIDEO",
          "invalid.mp4",
          "video/mp4",
          "10",
          "not-a-sha256",
          `uploads/${randomUUID()}/original.mp4`,
          "unknown",
          "queued",
        ],
      ),
    ).rejects.toThrow();
  });
});
