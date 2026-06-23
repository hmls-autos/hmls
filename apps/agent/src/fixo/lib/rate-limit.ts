import { sql } from "drizzle-orm";
import { db, schema } from "../../db/client.ts";

export const RATE_LIMITS = { perMin: 20, perDay: 200 } as const;

/** Pure: fixed-window bucket keys for a given instant. */
export function bucketKeys(now: Date): { min: string; day: string } {
  const iso = now.toISOString();
  return { min: `min:${iso.slice(0, 16)}`, day: `day:${iso.slice(0, 10)}` };
}

async function bump(keyId: string, bucket: string): Promise<number> {
  // Atomic upsert-increment; returns the new count for this window.
  const [row] = await db.insert(schema.fixoRateLimit)
    .values({ keyId, bucket, count: 1 })
    .onConflictDoUpdate({
      target: [schema.fixoRateLimit.keyId, schema.fixoRateLimit.bucket],
      set: { count: sql`${schema.fixoRateLimit.count} + 1` },
    })
    .returning({ count: schema.fixoRateLimit.count });
  return row.count;
}

/** Increment both windows; over either limit → not ok. Date is runtime-only
 *  (gateway request handler, not a workflow script — `new Date()` is fine). */
export async function checkRateLimit(
  keyId: string,
): Promise<{ ok: true } | { ok: false; scope: "min" | "day" }> {
  const { min, day } = bucketKeys(new Date());
  const minCount = await bump(keyId, min);
  if (minCount > RATE_LIMITS.perMin) return { ok: false, scope: "min" };
  const dayCount = await bump(keyId, day);
  if (dayCount > RATE_LIMITS.perDay) return { ok: false, scope: "day" };
  return { ok: true };
}
