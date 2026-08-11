import "reflect-metadata";

import { DataSource } from "typeorm";

import { AuditLogEntity } from "./entities/audit-log.entity.js";
import { JobOutboxEntity } from "./entities/job-outbox.entity.js";
import { MediaMetadataEntity } from "./entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "./entities/media-segment.entity.js";
import { SessionEntity } from "./entities/session.entity.js";
import { SubmissionEntity } from "./entities/submission.entity.js";
import { TeamEntity } from "./entities/team.entity.js";
import { UserEntity } from "./entities/user.entity.js";
import { Identity2026080700001 } from "./migrations/202608070001-identity.js";
import { VideoIngestion2026080700002 } from "./migrations/202608070002-video-ingestion.js";

export const identityEntities = [
  TeamEntity,
  UserEntity,
  SessionEntity,
  AuditLogEntity,
  SubmissionEntity,
  MediaMetadataEntity,
  MediaSegmentEntity,
  JobOutboxEntity,
];

export function createDataSource(
  databaseUrl = process.env.DATABASE_URL,
): DataSource {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return new DataSource({
    type: "postgres",
    url: databaseUrl,
    entities: identityEntities,
    migrations: [
      Identity2026080700001,
      VideoIngestion2026080700002,
    ],
    synchronize: false,
    logging: false,
  });
}
