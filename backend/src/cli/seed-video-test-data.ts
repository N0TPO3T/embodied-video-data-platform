import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { In, type DataSource, type EntityManager } from "typeorm";

import { createDataSource } from "../database/data-source.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import {
  SubmissionEntity,
  type SubmissionProcessingStatus,
} from "../database/entities/submission.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";

export const VIDEO_TEST_DATA_IDS = Array.from(
  { length: 6 },
  (_, index) => `TEST-VIDEO-${String(index + 1).padStart(3, "0")}`,
);

type VideoFixture = {
  id: string;
  fileName: string;
  processingStatus: SubmissionProcessingStatus;
  sizeBytes: number;
  failureCode?: string;
  failureMessage?: string;
  metadata?: {
    durationSeconds: number;
    width: number;
    height: number;
    frameRate: number;
    codec: string;
    bitrate: number;
  };
};

const fixtures: VideoFixture[] = [
  {
    id: VIDEO_TEST_DATA_IDS[0]!,
    fileName: "测试-整理工具并归位-01.mp4",
    processingStatus: "queued",
    sizeBytes: 188_743_680,
  },
  {
    id: VIDEO_TEST_DATA_IDS[1]!,
    fileName: "测试-擦拭收纳箱外壁-02.mp4",
    processingStatus: "queued",
    sizeBytes: 251_658_240,
  },
  {
    id: VIDEO_TEST_DATA_IDS[2]!,
    fileName: "测试-装配风扇网罩-03.mp4",
    processingStatus: "probing",
    sizeBytes: 322_961_408,
  },
  {
    id: VIDEO_TEST_DATA_IDS[3]!,
    fileName: "测试-更换金属鞋带头-04.mp4",
    processingStatus: "awaiting_ai",
    sizeBytes: 398_458_880,
    metadata: {
      durationSeconds: 646.42,
      width: 1920,
      height: 1080,
      frameRate: 59.94,
      codec: "h264",
      bitrate: 4_931_000,
    },
  },
  {
    id: VIDEO_TEST_DATA_IDS[4]!,
    fileName: "测试-拆装头戴耳机耳罩-05.mp4",
    processingStatus: "awaiting_ai",
    sizeBytes: 287_309_824,
    metadata: {
      durationSeconds: 342.18,
      width: 1920,
      height: 1080,
      frameRate: 60,
      codec: "hevc",
      bitrate: 6_718_000,
    },
  },
  {
    id: VIDEO_TEST_DATA_IDS[5]!,
    fileName: "测试-损坏文件示例-06.mov",
    processingStatus: "system_failed",
    sizeBytes: 450_887_680,
    failureCode: "MEDIA_PROCESSING_FAILED",
    failureMessage: "测试数据：媒体处理进程中断，等待人工重试",
    metadata: {
      durationSeconds: 703.27,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      bitrate: 5_126_000,
    },
  },
];

function fixtureChecksum(id: string): string {
  return createHash("sha256")
    .update(`evdp-local-test-fixture:${id}`)
    .digest("hex");
}

async function firstCollectorInTwoTeams(manager: EntityManager) {
  const collectors = await manager
    .getRepository(UserEntity)
    .createQueryBuilder("user")
    .where("user.role = :role", { role: "collector" })
    .andWhere("user.status = :status", { status: "active" })
    .andWhere("user.teamId IS NOT NULL")
    .orderBy("user.teamId", "ASC")
    .addOrderBy("user.id", "ASC")
    .getMany();
  const byTeam = new Map<string, UserEntity>();
  for (const collector of collectors) {
    if (collector.teamId && !byTeam.has(collector.teamId)) {
      byTeam.set(collector.teamId, collector);
    }
  }
  const result = [...byTeam.values()].slice(0, 2);
  if (result.length < 2) {
    throw new Error("至少需要两个各自拥有启用数采人员的团队才能写入视频测试数据");
  }
  return result as [UserEntity, UserEntity];
}

export async function seedVideoTestData(options: {
  dataSource: DataSource;
}): Promise<{ created: number; skipped: number }> {
  return options.dataSource.transaction(async (manager) => {
    const owners = await firstCollectorInTwoTeams(manager);
    const submissions = manager.getRepository(SubmissionEntity);
    const existing = new Set(
      (
        await submissions.find({
          select: { id: true },
          where: { id: In(VIDEO_TEST_DATA_IDS) },
        })
      ).map((record) => record.id),
    );
    const missing = fixtures.filter((fixture) => !existing.has(fixture.id));
    const now = Date.now();

    for (const fixture of missing) {
      const originalIndex = fixtures.findIndex(
        (candidate) => candidate.id === fixture.id,
      );
      const owner = owners[originalIndex % owners.length]!;
      const extension = fixture.fileName.endsWith(".mov") ? ".mov" : ".mp4";
      const createdAt = new Date(now - (fixtures.length - originalIndex) * 60_000);
      await submissions.save({
        id: fixture.id,
        ownerId: owner.id,
        teamId: owner.teamId!,
        originalFileName: fixture.fileName,
        contentType: extension === ".mov" ? "video/quicktime" : "video/mp4",
        expectedSizeBytes: String(fixture.sizeBytes),
        checksumSha256: fixtureChecksum(fixture.id),
        objectKey: `test-data/${owner.teamId}/${fixture.id}/fixture${extension}`,
        multipartUploadId: null,
        uploadStatus: "uploaded",
        processingStatus: fixture.processingStatus,
        failureCode: fixture.failureCode ?? null,
        failureMessage: fixture.failureMessage ?? null,
        isTestData: true,
        uploadedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
      if (fixture.metadata) {
        await manager.getRepository(MediaMetadataEntity).save({
          submissionId: fixture.id,
          durationSeconds: fixture.metadata.durationSeconds.toFixed(3),
          width: fixture.metadata.width,
          height: fixture.metadata.height,
          frameRate: fixture.metadata.frameRate.toFixed(3),
          codec: fixture.metadata.codec,
          bitrate: String(fixture.metadata.bitrate),
          sizeBytes: String(fixture.sizeBytes),
          rawProbe: {
            fixture: true,
            source: "local_test_data_not_ai",
            format: { format_name: extension === ".mov" ? "mov" : "mp4" },
          },
        });
      }
    }

    return {
      created: missing.length,
      skipped: fixtures.length - missing.length,
    };
  });
}

async function runCli(): Promise<void> {
  const dataSource = createDataSource();
  try {
    await dataSource.initialize();
    console.log(JSON.stringify(await seedVideoTestData({ dataSource })));
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await runCli();
}
