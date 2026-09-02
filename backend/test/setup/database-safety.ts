import { PostgresDriver } from "typeorm/driver/postgres/PostgresDriver.js";

// Test-only connection boundary: includes Nest-created DataSources, raw
// QueryRunner SQL, migration down, synchronize(true), and bootstrap resets.
// Do not set the opt-in here: the caller must explicitly authorize data loss.
function assertDisposableDatabase(database: unknown): asserts database is string {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Database tests require NODE_ENV=test");
  }
  if (process.env.ALLOW_TEST_DATABASE_RESET !== "true") {
    throw new Error("Database tests require ALLOW_TEST_DATABASE_RESET=true");
  }
  if (
    typeof database !== "string" ||
    !/^[a-z0-9_-]+$/i.test(database) ||
    !/(?:^test_|_test(?:_|$)|^e2e_|_e2e(?:_|$))/i.test(database) ||
    ["evdp", "postgres", "template0", "template1"].includes(database.toLowerCase())
  ) {
    // Never print the connection URL (it can contain credentials).
    throw new Error(
      "Database tests require an explicit disposable database name with a test/e2e underscore-delimited marker",
    );
  }
}

const connect = PostgresDriver.prototype.connect;
PostgresDriver.prototype.connect = async function () {
  assertDisposableDatabase(this.database);
  // Replication is not used by this suite. Fail closed instead of trusting an
  // unvalidated secondary target or silently checking only the primary.
  if (this.options.replication) {
    throw new Error("Database tests do not support replication targets");
  }
  try {
    await connect.call(this);
  } catch (error) {
    // TypeORM initializes its pool before checking the actual database, and
    // DataSource.initialize does not clean up a failed driver.connect itself.
    if (this.master) await this.disconnect();
    throw error;
  }
};

for (const method of ["obtainMasterConnection", "obtainSlaveConnection"] as const) {
  const obtain = PostgresDriver.prototype[method];
  PostgresDriver.prototype[method] = async function () {
    assertDisposableDatabase(this.database);
    const [connection, release] = await obtain.call(this);
    try {
      // Probe the same physical connection before handing it to TypeORM.
      // This also catches URL/driver overrides and unexpected server routing.
      const result = await connection.query("SELECT current_database() AS database");
      const actualDatabase: unknown = result.rows?.[0]?.database;
      assertDisposableDatabase(actualDatabase);
      if (actualDatabase !== this.database) {
        throw new Error("Database test target differs from the actual connected database");
      }
      return [connection, release];
    } catch (error) {
      release();
      throw error;
    }
  };
}
