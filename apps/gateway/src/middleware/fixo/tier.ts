import { db, schema } from "@hmls/agent/db";
import { and, eq, gte, sql } from "drizzle-orm";
import type { AuthContext } from "./auth.ts";

const FREE_LIMITS = { text: 3 } as const;

export async function checkFreeTierLimit(
  auth: AuthContext,
  inputType: string,
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

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.diagnosticSessions)
    .where(
      and(
        eq(schema.diagnosticSessions.userId, auth.userId),
        gte(schema.diagnosticSessions.createdAt, monthStart),
      ),
    );

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
