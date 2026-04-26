import { db, schema } from "@hmls/agent/db";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import type { AuthContext } from "./auth.ts";

const FREE_LIMITS = { text: 3 } as const;

/**
 * Free-tier rate limit on diagnostic sessions per month.
 *
 * `excludeSessionId` is for endpoints called against an already-created
 * session (like /complete). The session was already counted when the
 * Report-click flow created it; counting it again here would block the
 * user's third report at limit=3 even though only 2 prior sessions exist.
 */
export async function checkFreeTierLimit(
  auth: AuthContext,
  inputType: string,
  excludeSessionId?: number,
): Promise<Response | null> {
  if (auth.tier === "plus") return null; // Plus users: no limits

  const limit = FREE_LIMITS[inputType as keyof typeof FREE_LIMITS];
  if (limit === undefined) {
    // Free users can only use text
    return new Response(
      JSON.stringify({
        error: "upgrade_required",
        message: "Upgrade to Plus to use photo, audio, video, and OBD diagnostics",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // Count this month's sessions
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const conditions = [
    eq(schema.fixoSessions.userId, auth.userId),
    gte(schema.fixoSessions.createdAt, monthStart),
    // Don't penalize the user for transient failures — a session whose
    // /complete crashed before producing a result shouldn't permanently
    // consume one of their three monthly slots.
    ne(schema.fixoSessions.status, "failed"),
  ];
  if (excludeSessionId !== undefined) {
    conditions.push(ne(schema.fixoSessions.id, excludeSessionId));
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.fixoSessions)
    .where(and(...conditions));

  if (Number(count) >= limit) {
    return new Response(
      JSON.stringify({
        error: "limit_reached",
        message:
          `Free plan limit reached (${limit} text diagnoses/month). Upgrade to Plus for unlimited access.`,
        usage: { used: Number(count), limit },
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return null; // Under limit, proceed
}
