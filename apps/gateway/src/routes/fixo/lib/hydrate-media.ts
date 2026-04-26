import type { UIMessage } from "ai";
import { and, eq } from "drizzle-orm";
import { createSignedReadUrl } from "@hmls/agent";
import { db, schema } from "@hmls/agent/db";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["hmls", "gateway", "fixo", "hydrate-media"]);

const SIGNED_URL_TTL_SECONDS = 900; // 15 min — outlives any practical Gemini fetch

/**
 * Hydrate fixoMedia rows for a session as FileUIParts on the latest user
 * message, so the model can see attached photos (and audio spectrograms)
 * natively rather than via a fetch-by-URL tool. Mutates `messages` in place.
 *
 * Bucket-side files are private; we mint short-lived signed read URLs only
 * when the model is about to consume them. Used by both /task (chat stream)
 * and /complete (final session summary) so neither flow drops attachments.
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

  const mediaRows = await db
    .select()
    .from(schema.fixoMedia)
    .where(
      and(
        eq(schema.fixoMedia.sessionId, sessionId),
        eq(schema.fixoMedia.processingStatus, "complete"),
      ),
    );
  if (mediaRows.length === 0) return 0;

  // Find the last user-role message; that's where we attach the media so the
  // model treats it as input to the current turn.
  let target: UIMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      target = messages[i];
      break;
    }
  }
  if (!target) return 0;
  if (!Array.isArray(target.parts)) target.parts = [];

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
