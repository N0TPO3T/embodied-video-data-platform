import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";

export async function createTestD1(): Promise<{
  db: D1Database;
  dispose: () => Promise<void>;
}> {
  const miniflare = new Miniflare({
    modules: true,
    script:
      "export default { fetch() { return new Response('test worker'); } }",
    d1Databases: { DB: "account-test" },
  });
  const db = await miniflare.getD1Database("DB");
  const migration = await readFile(
    new URL("../../../drizzle/0000_account-authentication.sql", import.meta.url),
    "utf8",
  );

  for (const sql of migration.split("--> statement-breakpoint")) {
    const statement = sql.trim();
    if (statement) {
      await db.prepare(statement).run();
    }
  }

  return {
    db,
    dispose: () => miniflare.dispose(),
  };
}
