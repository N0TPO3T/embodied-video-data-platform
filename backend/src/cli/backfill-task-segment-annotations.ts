import { createDataSource } from "../database/data-source.js";
import { MinioObjectStorageService } from "../storage/minio-object-storage.service.js";
import { TaskSegmentAnnotationService } from "../task-segment/task-segment-annotation.service.js";

const args = process.argv.slice(2).filter(a => a !== "--");
if (args.some(a => a !== "--dry-run" && !a.startsWith("--limit=") && !a.startsWith("--after=")) ||
    (!args.includes("--dry-run") && !args.some(a => a.startsWith("--limit=")))) {
  throw new Error("Use --dry-run or an explicit --limit=1..1000; optional --after=assetId");
}
const limit = Number(args.find(a => a.startsWith("--limit="))?.slice(8) ?? 100);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid limit");
function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}
const dataSource = createDataSource();
try {
  await dataSource.initialize();
  const storage = new MinioObjectStorageService(required("MINIO_BUCKET"), {
    endpoint: required("MINIO_ENDPOINT"), publicEndpoint: required("MINIO_PUBLIC_ENDPOINT"),
    accessKey: required("MINIO_ACCESS_KEY"), secretKey: required("MINIO_SECRET_KEY"),
    region: process.env.MINIO_REGION ?? "us-east-1", forcePathStyle: process.env.MINIO_FORCE_PATH_STYLE !== "false",
  });
  console.log(JSON.stringify(await new TaskSegmentAnnotationService(dataSource, storage).backfill({
    dryRun: args.includes("--dry-run"), limit, after: args.find(a => a.startsWith("--after="))?.slice(8),
  })));
} catch {
  // Do not print connection URLs, provider messages or source annotation content.
  console.error("SEGMENT_ANNOTATION_BACKFILL_FAILED");
  process.exitCode = 1;
} finally {
  if (dataSource.isInitialized) await dataSource.destroy();
}
