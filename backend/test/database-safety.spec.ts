import { EventEmitter } from "node:events";
import { DataSource } from "typeorm";
import { PostgresDriver } from "typeorm/driver/postgres/PostgresDriver.js";

const probe = "SELECT current_database() AS database";

// Exercise the real TypeORM entry points with a fake pg pool. This suite never
// opens a socket, even if the safety setup is accidentally removed.
describe("database test safety", () => {
  let actualDatabase: string | undefined;
  let query: ReturnType<typeof vi.fn>;
  let release: ReturnType<typeof vi.fn>;
  let end: ReturnType<typeof vi.fn>;
  let poolConstructed: ReturnType<typeof vi.fn<() => void>>;
  let dataSource: DataSource;

  function source(database = "evdp_test", options = {}) {
    dataSource = new DataSource({
      type: "postgres",
      url: `postgresql://test_user:fake_test_password@disposable.invalid/${database}`,
      installExtensions: false,
      ...options,
    });
    const driver = dataSource.driver as PostgresDriver;
    // Avoid unrelated server-version/schema introspection in the fake pool.
    driver.version = "17.0";
    driver.searchSchema = "public";
    driver.schema = "public";
    vi.spyOn(driver.postgres, "Pool").mockImplementation(function () {
      poolConstructed();
      const client = Object.assign(new EventEmitter(), { query });
      return {
        on: vi.fn(),
        connect: (callback: (...args: unknown[]) => void) =>
          callback(null, client, release),
        end,
      };
    });
    return dataSource;
  }

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ALLOW_TEST_DATABASE_RESET", "true");
    actualDatabase = "evdp_test";
    query = vi.fn(async (sql: string) => ({
      rows: sql === probe ? [{ database: actualDatabase }] : [],
      rowCount: 0,
    }));
    release = vi.fn();
    end = vi.fn((callback: () => void) => callback());
    poolConstructed = vi.fn();
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    "evdp", "postgres", "template0", "template1", "production",
    "evdp_local_pr40", "evdp_testing", "contest_db", "latest", "",
  ])("rejects %j before opening a pool", async (database) => {
    await expect(source(database).initialize()).rejects.toThrow(/disposable database/);
    expect(poolConstructed).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["production", "development", "", undefined])(
    "rejects NODE_ENV=%j regardless of opt-in and database name",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      await expect(source().initialize()).rejects.toThrow(/NODE_ENV=test/);
      expect(poolConstructed).not.toHaveBeenCalled();
    },
  );

  it.each(["false", "1", "TRUE", "", undefined])(
    "rejects ALLOW_TEST_DATABASE_RESET=%j",
    async (optIn) => {
      vi.stubEnv("ALLOW_TEST_DATABASE_RESET", optIn);
      await expect(source().initialize()).rejects.toThrow(/ALLOW_TEST_DATABASE_RESET=true/);
      expect(poolConstructed).not.toHaveBeenCalled();
    },
  );

  it.each([
    "evdp_test", "test_evdp", "evdp_e2e_01234567-89ab-cdef",
    "e2e_evdp", "evdp_test_container",
  ])("allows explicitly opted-in disposable database %s", async (database) => {
    actualDatabase = database;
    await expect(source(database).initialize()).resolves.toBe(dataSource);
    expect(query).toHaveBeenCalledWith(probe);
  });

  it.each(["evdp", "postgres", "template0", "template1", "another_test", undefined])(
    "blocks auto-reset when the server reports %j, despite a safe URL",
    async (database) => {
      actualDatabase = database;
      await expect(source("evdp_test", { dropSchema: true }).initialize()).rejects.toThrow();
      expect(query.mock.calls.map(([sql]) => sql)).toEqual([probe]);
      expect(release).toHaveBeenCalled();
      expect(end).toHaveBeenCalled();
    },
  );

  it("fails closed and releases the connection when the runtime probe fails", async () => {
    query.mockRejectedValue(new Error("probe unavailable"));
    await expect(source().initialize()).rejects.toThrow("probe unavailable");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([probe]);
    expect(release).toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
  });

  it("also cleans up when the runtime check fails during driver initialization", async () => {
    const ds = source();
    (ds.driver as PostgresDriver).version = undefined;
    actualDatabase = "evdp";
    await expect(ds.initialize()).rejects.toThrow(/disposable database/);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([probe]);
    expect(end).toHaveBeenCalled();
  });

  const destructiveOperations = [
    ["dropDatabase", (ds: DataSource) => ds.dropDatabase()],
    ["synchronize(true)", (ds: DataSource) => ds.synchronize(true)],
    ["migration down", (ds: DataSource) => ds.undoLastMigration()],
    ["raw DROP SCHEMA", (ds: DataSource) => ds.query("DROP SCHEMA public CASCADE")],
    ["bootstrap reset", (ds: DataSource) => ds.query("TRUNCATE users CASCADE")],
  ] as const;

  it.each(destructiveOperations)(
    "blocks %s if an acquired connection points to another database",
    async (_name, operation) => {
      const ds = source();
      await ds.initialize();
      query.mockClear();
      actualDatabase = "evdp";
      await expect(operation(ds)).rejects.toThrow(/disposable database/);
      expect(query.mock.calls.every(([sql]) => sql === probe)).toBe(true);
      expect(query).toHaveBeenCalledWith(probe);
    },
  );

  it("rechecks opt-in before handing out a connection for reset", async () => {
    const ds = source();
    await ds.initialize();
    query.mockClear();
    vi.stubEnv("ALLOW_TEST_DATABASE_RESET", "false");
    await expect(ds.dropDatabase()).rejects.toThrow(/ALLOW_TEST_DATABASE_RESET=true/);
    expect(query).not.toHaveBeenCalled();
  });

  it("allows guarded raw reset SQL only after the runtime check", async () => {
    const ds = source();
    await ds.initialize();
    query.mockClear();
    await ds.query("DROP SCHEMA public CASCADE");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      probe, "DROP SCHEMA public CASCADE",
    ]);
  });
});
