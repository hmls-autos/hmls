import type { UIMessage } from "ai";
import { and, eq } from "drizzle-orm";
import { createSignedReadUrl } from "@hmls/agent";
import { db, schema } from "@hmls/agent/db";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["hmls", "gateway", "fixo", "hydrate-media"]);

const SIGNED_URL_TTL_SECONDS = 900; // 15 min — outlives any practical Gemini fetch

/**
 * Hydrate a Fixo session's server-side state into the chat transcript before
 * the LLM sees it. Attaches uploaded photos as FileUIParts and stored OBD-II
 * codes as a text part, both on the latest user message. Mutates `messages`
 * in place; returns the count of FileUIParts added (OBD codes don't count).
 *
 * Why this exists: the client persists chatMessages to localStorage, but the
 * actual photo bytes live in Supabase Storage and OBD codes live in
 * fixo_obd_codes. Without this, /task and /complete would both run the LLM
 * over a transcript that's missing the evidence the diagnosis is based on.
 *
 * Bucket-side files are private; signed read URLs are short-lived (15 min)
 * so they outlive a single Gemini fetch but don't leak as durable links.
 */
export async function hydrateSessionMedia(
  messages: UIMessage[],
  sessionId: number,
  authUserId: string,
  authCustomerId: number | undefined,
): Promise<number> {
  if (messages.length === 0) return 0;

  // Verify the caller owns the session before we surface any media URLs.
  const [session] = await db
    .select()
    .from(schema.fixoSessions)
    .where(eq(schema.fixoSessions.id, sessionId))
    .limit(1);
  if (
    !session ||
    (session.userId !== authUserId && session.customerId !== authCustomerId)
  ) {
    return 0;
  }

  const [mediaRows, obdRows] = await Promise.all([
    db
      .select()
      .from(schema.fixoMedia)
      .where(
        and(
          eq(schema.fixoMedia.sessionId, sessionId),
          eq(schema.fixoMedia.processingStatus, "complete"),
        ),
      ),
    db
      .select()
      .from(schema.obdCodes)
      .where(eq(schema.obdCodes.sessionId, sessionId)),
  ]);
  if (mediaRows.length === 0 && obdRows.length === 0) return 0;

  // Find the last user-role message; that's where we attach hydrated content
  // so the model treats it as input to the current turn.
  let target: UIMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      target = messages[i];
      break;
    }
  }
  if (!target) return 0;
  if (!Array.isArray(target.parts)) target.parts = [];

  if (obdRows.length > 0) {
    target.parts.push({
      type: "text",
      text: `Stored OBD-II codes for this session: ${obdRows.map((r) => r.code).join(", ")}`,
    });
  }

  let attached = 0;
  for (const row of mediaRows) {
    const meta = (row.metadata ?? {}) as { contentType?: string };
    // Photo and the spectrogram-stored-as-photo case both render as image
    // parts. Audio/video rows are skipped here — Gemini's audio/video file
    // part support via @ai-sdk/google is unverified for our flow (codex #8,
    // tracked in TODOS.md).
    if (row.type !== "photo") continue;
    const mediaType = meta.contentType ?? "image/jpeg";

    try {
      const signedUrl = await createSignedReadUrl(
        row.storageKey,
        SIGNED_URL_TTL_SECONDS,
      );
      target.parts.push({ type: "file", mediaType, url: signedUrl });
      attached++;
    } catch (err) {
      logger.warn("Failed to sign URL for media row {mediaId}", {
        mediaId: row.id,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return attached;
}
