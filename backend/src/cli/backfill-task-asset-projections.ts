import { createDataSource } from "../database/data-source.js";
import { backfillTaskAssetProjections, parseProjectionBackfillArgs } from "../task-asset/task-asset-projection-backfill.js";

const input = parseProjectionBackfillArgs(process.argv.slice(2));
const dataSource = createDataSource();
try {
  await dataSource.initialize();
  const result = await backfillTaskAssetProjections(dataSource, input);
  console.log(JSON.stringify(result));
  if (result.failed || result.blocked) process.exitCode = 1;
} catch {
  console.error("TASK_ASSET_PROJECTION_BACKFILL_FAILED");
  process.exitCode = 1;
} finally {
  if (dataSource.isInitialized) await dataSource.destroy();
}
