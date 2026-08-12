import { In, type DataSource } from "typeorm";

import { seedVideoTestData } from "../src/cli/seed-video-test-data.js";
import { createDataSource } from "../src/database/data-source.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const TEST_VIDEO_IDS = Array.from(
  { length: 6 },
  (_, index) => `TEST-VIDEO-${String(index + 1).padStart(3, "0")}`,
);

async function removeOnlyThisTestData(dataSource: DataSource): Promise<void> {
  await dataSource
    .getRepository(SubmissionEntity)
    .delete({ id: In(TEST_VIDEO_IDS) });
  await dataSource
    .getRepository(UserEntity)
    .delete({ id: In(["COLLECTOR-SEED-01", "COLLECTOR-SEED-02"]) });
  await dataSource
    .getRepository(TeamEntity)
    .delete({ id: In(["TEAM-SEED-01", "TEAM-SEED-02"]) });
}

describe("video test-data seed", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.runMigrations();
    await removeOnlyThisTestData(dataSource);
    await dataSource.getRepository(TeamEntity).save([
      { id: "TEAM-SEED-01", name: "种子一队" },
      { id: "TEAM-SEED-02", name: "种子二队" },
    ]);
    await dataSource.getRepository(UserEntity).save([
      {
        id: "COLLECTOR-SEED-01",
        displayName: "种子数采一",
        username: "seed-collector-01",
        usernameNormalized: "seed-collector-01",
        passwordHash: "argon-hash",
        role: "collector",
        teamId: "TEAM-SEED-01",
        status: "active",
      },
      {
        id: "COLLECTOR-SEED-02",
        displayName: "种子数采二",
        username: "seed-collector-02",
        usernameNormalized: "seed-collector-02",
        passwordHash: "argon-hash",
        role: "collector",
        teamId: "TEAM-SEED-02",
        status: "active",
      },
    ]);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await removeOnlyThisTestData(dataSource);
      await dataSource.destroy();
    }
  });

  it("creates six clearly marked records across two teams without AI scores", async () => {
    await expect(seedVideoTestData({ dataSource })).resolves.toEqual({
      created: 6,
      skipped: 0,
    });

    const records = await dataSource.getRepository(SubmissionEntity).find({
      where: { id: In(TEST_VIDEO_IDS), isTestData: true },
      order: { id: "ASC" },
    });
    expect(records).toHaveLength(6);
    expect(new Set(records.map((record) => record.teamId)).size).toBe(2);
    expect(records.every((record) => record.uploadStatus === "uploaded")).toBe(
      true,
    );
    expect(new Set(records.map((record) => record.processingStatus))).toEqual(
      new Set(["queued", "probing", "awaiting_ai", "system_failed"]),
    );
    expect(
      await dataSource.getRepository(MediaMetadataEntity).countBy({
        submissionId: In(TEST_VIDEO_IDS),
      }),
    ).toBe(3);
  });

  it("is idempotent and never overwrites the six known IDs", async () => {
    await expect(seedVideoTestData({ dataSource })).resolves.toEqual({
      created: 0,
      skipped: 6,
    });
    expect(
      await dataSource.getRepository(SubmissionEntity).countBy({
        id: In(TEST_VIDEO_IDS),
        isTestData: true,
      }),
    ).toBe(6);
  });
});
