import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Create a lazy-initialized database client with the given schema.
 * Each app passes its own schema for type-safe queries.
 */
export function createDbClient<T extends Record<string, unknown>>(
  schema: T,
): ReturnType<typeof drizzle<T>> {
  let _db: ReturnType<typeof drizzle<T>> | null = null;
  let _client: ReturnType<typeof postgres> | null = null;

  function getDb() {
    if (!_db) {
      const connectionString = Deno.env.get("DATABASE_URL");
      if (!connectionString) {
        throw new Error("DATABASE_URL environment variable is required");
      }
      _client = postgres(connectionString);
      // deno-lint-ignore no-explicit-any
      _db = drizzle(_client as any, { schema });
    }
    return _db;
  }

  return new Proxy({} as ReturnType<typeof drizzle<T>>, {
    get(_target, prop) {
      const realDb = getDb();
      const value = realDb[prop as keyof typeof realDb];
      if (typeof value === "function") {
        return value.bind(realDb);
      }
      return value;
    },
  });
}
