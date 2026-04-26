import type { FileUIPart, UIMessage } from "ai";
import { and, eq } from "drizzle-orm";
import { createSignedReadUrl } from "@hmls/agent";
import { db, schema } from "@hmls/agent/db";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["hmls", "gateway", "fixo", "hydrate-media"]);

const SIGNED_URL_TTL_SECONDS = 900; // 15 min — outlives any practical Gemini fetch

interface SessionEvidence {
  obdCodes: string[];
  photoFileParts: FileUIPart[];
}

/**
 * Fetch the server-side evidence (uploaded photos and stored OBD-II codes)
 * for a session, gated by ownership. Returns parts ready to splice into a
 * UIMessage array. Used by both /task hydration and /complete summarization.
 *
 * Photos return as FileUIPart with short-lived signed URLs (15 min) — long
 * enough for one Gemini fetch, short enough not to leak as durable links.
 */
async function loadSessionEvidence(
  sessionId: number,
  authUserId: string,
  authCustomerId: number | undefined,
): Promise<SessionEvidence | null> {
  // Verify the caller owns the session before we surface any URLs or codes.
  const [session] = await db
    .select()
    .from(schema.fixoSessions)
    .where(eq(schema.fixoSessions.id, sessionId))
    .limit(1);
  if (
    !session ||
    (session.userId !== authUserId && session.customerId !== authCustomerId)
  ) {
    return null;
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

  const photoFileParts: FileUIPart[] = [];
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
      photoFileParts.push({ type: "file", mediaType, url: signedUrl });
    } catch (err) {
      logger.warn("Failed to sign URL for media row {mediaId}", {
        mediaId: row.id,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    obdCodes: obdRows.map((r) => r.code),
    photoFileParts,
  };
}

/**
 * Attach session evidence (photos + OBD codes) to the LATEST user message.
 * Used by /task because the user just sent that message and the upload
 * belongs to the active turn — the model sees the photo at exactly the
 * right point in the conversation. Mutates `messages` in place; returns
 * the count of FileUIParts added.
 */
export async function hydrateSessionMedia(
  messages: UIMessage[],
  sessionId: number,
  authUserId: string,
  authCustomerId: number | undefined,
): Promise<number> {
  if (messages.length === 0) return 0;

  const evidence = await loadSessionEvidence(
    sessionId,
    authUserId,
    authCustomerId,
  );
  if (!evidence) return 0;
  if (evidence.obdCodes.length === 0 && evidence.photoFileParts.length === 0) {
    return 0;
  }

  let target: UIMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      target = messages[i];
      break;
    }
  }
  if (!target) return 0;
  if (!Array.isArray(target.parts)) target.parts = [];

  if (evidence.obdCodes.length > 0) {
    target.parts.push({
      type: "text",
      text: `Stored OBD-II codes for this session: ${evidence.obdCodes.join(", ")}`,
    });
  }
  for (const part of evidence.photoFileParts) {
    target.parts.push(part);
  }

  return evidence.photoFileParts.length;
}

/**
 * PREPEND a synthetic user message containing all session evidence to the
 * front of the transcript. Used by /complete because we're summarizing the
 * whole conversation, not advancing the active turn — the LLM should have
 * the photos and OBD codes as session-wide context from the start, before
 * the assistant turns that referenced them. Without this, multi-turn
 * sessions would put evidence after the diagnosis, breaking attribution.
 *
 * Mutates `messages` in place; returns the count of FileUIParts added.
 */
export async function prependSessionEvidence(
  messages: UIMessage[],
  sessionId: number,
  authUserId: string,
  authCustomerId: number | undefined,
): Promise<number> {
  const evidence = await loadSessionEvidence(
    sessionId,
    authUserId,
    authCustomerId,
  );
  if (!evidence) return 0;
  if (evidence.obdCodes.length === 0 && evidence.photoFileParts.length === 0) {
    return 0;
  }

  const introText = "Session evidence (uploaded by the user during this " +
    "diagnostic session, listed here as session-wide context):";

  const parts: UIMessage["parts"] = [{ type: "text", text: introText }];
  if (evidence.obdCodes.length > 0) {
    parts.push({
      type: "text",
      text: `OBD-II codes: ${evidence.obdCodes.join(", ")}`,
    });
  }
  for (const part of evidence.photoFileParts) {
    parts.push(part);
  }

  messages.unshift({
    id: `session-evidence-${sessionId}`,
    role: "user",
    parts,
  });

  return evidence.photoFileParts.length;
}
