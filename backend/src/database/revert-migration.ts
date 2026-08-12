import { createDataSource } from "./data-source.js";

const dataSource = createDataSource();

try {
  await dataSource.initialize();
  await dataSource.undoLastMigration({ transaction: "all" });
} finally {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}
