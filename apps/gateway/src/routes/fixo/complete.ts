import { Hono } from "hono";
import { convertToModelMessages, type UIMessage } from "ai";
import { db, schema } from "@hmls/agent/db";
import { eq } from "drizzle-orm";
import { summarizeFixoSession } from "@hmls/agent";
import { getLogger } from "@logtape/logtape";
import type { AuthContext } from "../../middleware/fixo/auth.ts";
import { checkFreeTierLimit } from "../../middleware/fixo/tier.ts";
import { prependSessionEvidence } from "./lib/hydrate-media.ts";

const logger = getLogger(["hmls", "gateway", "fixo", "complete"]);

type Variables = { auth: AuthContext };

const complete = new Hono<{ Variables: Variables }>();

// POST /sessions/:id/complete - Finalize session: generate structured result + mark complete.
//
// Body: { messages: UIMessage[] } - the full chat transcript from the client.
//
// Distinct from streaming chat: a separate generateObject call produces the structured
// JSON the PDF report endpoint expects. Marking status='complete' is explicit and
// triggered only by this endpoint, never on stream finish.
complete.post("/:id/complete", async (c) => {
  const auth = c.get("auth");
  const sessionId = parseInt(c.req.param("id"));

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return c.json({ error: "Invalid session ID" }, 400);
  }

  const [session] = await db
    .select()
    .from(schema.fixoSessions)
    .where(eq(schema.fixoSessions.id, sessionId))
    .limit(1);

  if (
    !session ||
    (session.userId !== auth.userId && session.customerId !== auth.customerId)
  ) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Cache-on-existence short-circuit: if a result is already stored, return it
  // without re-running generateObject. Makes re-downloads instant and lets
  // tier-limited users re-download finalized reports past the session quota.
  // Status reset on follow-up activity is the deferred TODO ("Session-reopen
  // on activity after completion") — until that lands, fresh diagnoses for an
  // already-finalized session require clearing the result server-side.
  if (session.result) {
    return c.json({
      sessionId,
      status: "complete",
      result: session.result,
      cached: true,
    });
  }

  // Tier gate runs AFTER the cache check so re-downloads work even at the
  // limit. POST /sessions itself isn't tier-gated, so without this a free
  // user could create unlimited fresh sessions and call /complete on each
  // for unlimited Gemini usage. We exclude the current session from the
  // count: it was already created (and counted) by ensureSession on the
  // Report click; double-counting it would block the third report at 3≥3.
  const tierBlock = await checkFreeTierLimit(auth, "text", sessionId);
  if (tierBlock) {
    logger.warn("Tier limit reached on first-time completion", {
      userId: auth.userId,
      sessionId,
    });
    return tierBlock;
  }

  let body: { messages?: UIMessage[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json(
      { error: "messages array is required and must be non-empty" },
      400,
    );
  }

  const startTime = Date.now();
  logger.info("Completing fixo session", {
    sessionId,
    userId: auth.userId,
    messageCount: messages.length,
  });

  try {
    // Prepend a synthetic message with session evidence so the summarizer
    // sees photos and OBD codes as session-wide context, ahead of any
    // assistant turn that referenced them. Different from /task, which
    // attaches evidence to the active turn — for a multi-turn summary,
    // putting evidence at the end of the transcript would land it after
    // the diagnosis and break attribution.
    const attachedMedia = await prependSessionEvidence(
      messages,
      sessionId,
      auth.userId,
      auth.customerId,
    );
    if (attachedMedia > 0) {
      logger.info("Prepended session evidence for completion", {
        sessionId,
        attachedMedia,
      });
    }

    const modelMessages = await convertToModelMessages(messages);
    const result = await summarizeFixoSession({ messages: modelMessages });

    await db
      .update(schema.fixoSessions)
      .set({
        result,
        status: "complete",
        completedAt: new Date(),
      })
      .where(eq(schema.fixoSessions.id, sessionId));

    const duration = Date.now() - startTime;
    logger.info("Fixo session completed", {
      sessionId,
      duration,
      issueCount: result.issues.length,
      overallSeverity: result.overallSeverity,
    });

    return c.json({ sessionId, status: "complete", result });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Failed to complete fixo session", {
      sessionId,
      duration,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Mark failed so the tier-quota count excludes this row — without this,
    // a transient Gemini error would permanently consume one of the user's
    // three monthly free-tier slots even though no result was produced.
    // Best-effort: a DB error here is not worth surfacing over the original.
    try {
      await db
        .update(schema.fixoSessions)
        .set({ status: "failed" })
        .where(eq(schema.fixoSessions.id, sessionId));
    } catch (markErr) {
      logger.warn("Could not mark fixo session as failed", {
        sessionId,
        error: markErr instanceof Error ? markErr.message : String(markErr),
      });
    }
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});

export { complete };
