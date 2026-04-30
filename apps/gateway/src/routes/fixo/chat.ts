import { Hono } from "hono";
import { convertToModelMessages, type UIMessage } from "ai";
import { runFixoAgent } from "@hmls/agent";
import { checkFreeTierLimit } from "../../middleware/fixo/tier.ts";
import { getLogger } from "@logtape/logtape";
import { db, schema } from "@hmls/agent/db";
import { and, eq, or } from "drizzle-orm";
import type { AuthContext } from "../../middleware/fixo/auth.ts";
import { hydrateSessionMedia } from "./lib/hydrate-media.ts";
import { reopenIfComplete } from "./lib/session-lifecycle.ts";

const logger = getLogger(["hmls", "gateway", "fixo", "chat"]);

type Variables = { auth: AuthContext };

const chat = new Hono<{ Variables: Variables }>();

// AI SDK data stream endpoint for fixo chat
chat.post("/", async (c) => {
  const auth = c.get("auth");

  // Validate that the user has an active subscription/tier before running the agent
  const tierBlock = await checkFreeTierLimit(auth, "text");
  if (tierBlock) {
    logger.warn("Tier limit reached", { userId: auth.userId });
    return tierBlock;
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "Invalid JSON body" },
      400,
    );
  }

  const { messages, sessionId } = body as {
    messages?: UIMessage[];
    sessionId?: number | string | null;
  };
  if (!messages || !Array.isArray(messages)) {
    return c.json(
      { error: "Invalid request: messages array is required" },
      400,
    );
  }

  const startTime = Date.now();
  const userId = auth.userId;
  const messageCount = messages.length;
  const parsedSessionId = typeof sessionId === "string"
    ? parseInt(sessionId)
    : typeof sessionId === "number"
    ? sessionId
    : null;
  logger.info("Request received", {
    userId,
    messageCount,
    sessionId: parsedSessionId,
  });

  try {
    // Snapshot the inbound messages BEFORE hydrateSessionMedia mutates them
    // with signed-URL FileUIParts. Those URLs expire in 15 min, so persisting
    // the hydrated copy would leave stale links in the saved transcript that
    // 403 on cross-device resume. Persist the user-visible transcript only;
    // the gateway re-hydrates evidence on every turn from fixoMedia anyway.
    const originalMessages: UIMessage[] = structuredClone(messages);

    let attachedMedia = 0;
    if (parsedSessionId !== null && Number.isInteger(parsedSessionId)) {
      // Follow-up activity after a finalized session re-opens it so the
      // next Report click regenerates the diagnosis from the fuller chat.
      // Ownership is folded into the UPDATE so an attacker can't wipe
      // someone else's completed report by guessing their session id.
      await reopenIfComplete(
        parsedSessionId,
        auth.userId,
        auth.customerId,
      );
      attachedMedia = await hydrateSessionMedia(
        messages,
        parsedSessionId,
        auth.userId,
        auth.customerId,
      );
      if (attachedMedia > 0) {
        logger.info("Hydrated session media", {
          sessionId: parsedSessionId,
          attachedMedia,
        });
      }
    }

    const modelMessages = await convertToModelMessages(messages);

    const result = runFixoAgent({ messages: modelMessages, userId });

    const response = result.toUIMessageStreamResponse({
      originalMessages,
      onFinish: async ({ messages: finalMessages }) => {
        if (parsedSessionId === null) return;
        // Ownership-scoped UPDATE — guessing another user's session id can't
        // overwrite their transcript. No-op if they don't own this row.
        const ownerPredicate = auth.customerId !== undefined
          ? or(
            eq(schema.fixoSessions.userId, auth.userId),
            eq(schema.fixoSessions.customerId, auth.customerId),
          )
          : eq(schema.fixoSessions.userId, auth.userId);
        try {
          await db
            .update(schema.fixoSessions)
            .set({ messages: finalMessages })
            .where(
              and(
                eq(schema.fixoSessions.id, parsedSessionId),
                ownerPredicate,
              ),
            );
        } catch (err) {
          // Persistence is best-effort: localStorage on the client still has
          // the same transcript, so a transient DB hiccup doesn't lose user
          // data. Log so we notice if it becomes systematic.
          logger.warn("Failed to persist chat transcript", {
            sessionId: parsedSessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    });
    const duration = Date.now() - startTime;
    logger.info("Request finished", {
      userId,
      messageCount,
      duration,
      attachedMedia,
    });
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Agent failed", {
      userId,
      messageCount,
      duration,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

export { chat };
