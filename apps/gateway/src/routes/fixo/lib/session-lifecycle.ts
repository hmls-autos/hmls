import { and, eq, or } from "drizzle-orm";
import { db, schema } from "@hmls/agent/db";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["hmls", "gateway", "fixo", "lifecycle"]);

/**
 * Re-open a previously-finalized session when its OWNER keeps interacting.
 *
 * After /complete writes status='complete' + result, follow-up activity (a
 * new /task turn or another /sessions/:id/input) means the prior diagnosis
 * is stale: the new conversation deserves a fresh report. Flip the row back
 * to 'processing' and null out result/completedAt so /complete's cache
 * short-circuit doesn't return the stale snapshot on the next Report click.
 *
 * The auth predicate is folded into the WHERE clause so an attacker passing
 * another user's session id can't wipe their completed report. Single atomic
 * UPDATE, cheap to call on hot paths. No-op if the session isn't 'complete'
 * or if the caller doesn't own it.
 */
export async function reopenIfComplete(
  sessionId: number,
  authUserId: string,
  authCustomerId: number | undefined,
): Promise<boolean> {
  const ownerPredicate = authCustomerId !== undefined
    ? or(
      eq(schema.fixoSessions.userId, authUserId),
      eq(schema.fixoSessions.customerId, authCustomerId),
    )
    : eq(schema.fixoSessions.userId, authUserId);

  const updated = await db
    .update(schema.fixoSessions)
    .set({ status: "processing", result: null, completedAt: null })
    .where(
      and(
        eq(schema.fixoSessions.id, sessionId),
        eq(schema.fixoSessions.status, "complete"),
        ownerPredicate,
      ),
    )
    .returning({ id: schema.fixoSessions.id });
  const reopened = updated.length > 0;
  if (reopened) {
    logger.info("Reopened completed session on follow-up activity", {
      sessionId,
    });
  }
  return reopened;
}
