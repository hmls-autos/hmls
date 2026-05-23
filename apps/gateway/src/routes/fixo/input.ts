import { Hono } from "hono";
import { db, schema } from "@hmls/agent/db";
import { and, eq } from "drizzle-orm";
import { createSignedUploadUrl, getObjectInfo, type InputKind, uploadMedia } from "@hmls/agent";
import { chargeForInput } from "../../middleware/fixo/credits.ts";
import type { AuthContext } from "../../middleware/fixo/auth.ts";

type Variables = { auth: AuthContext };

const input = new Hono<{ Variables: Variables }>();

/** Verify a client-declared contentType is plausible for the requested input
 * type. Defense-in-depth alongside the bucket-side allowed_mime_types config. */
export function contentTypeMatches(
  type: "photo" | "audio" | "video",
  contentType: string,
): boolean {
  if (type === "photo") return contentType.startsWith("image/");
  if (type === "audio") return contentType.startsWith("audio/");
  if (type === "video") return contentType.startsWith("video/");
  return false;
}

// F6 caps. Server side, can't be bypassed by lying client.
const MAX_DURATION_SECONDS = 600;
// Base64 inflates raw bytes by ~4/3, so a 50 MB ceiling on the encoded
// string maps to ~37 MB raw. Guards against memory abuse during decode +
// keeps individual uploads sane.
const MAX_BASE64_LENGTH = 50 * 1024 * 1024;
// Raw-byte ceiling for the presigned upload flow (/input/init + /complete).
// Matches the practical limit of the legacy inline path (~37 MB raw after
// base64 inflation) — kept aligned so behavior doesn't drift between flows.
// Bucket-side `file_size_limit` on `fixo-media` should mirror this as a
// belt-and-suspenders cap the SDK can't bypass.
export const MAX_RAW_BYTES = 37 * 1024 * 1024;
// Tolerance between client-declared sizeBytes and actual stored size at
// /complete time. Small slack absorbs any header/encoding rounding; anything
// bigger means the client lied to underpay credits.
const SIZE_MISMATCH_TOLERANCE_BYTES = 1024;

/** Estimate raw byte size of a base64 string without decoding (cheap).
 * Returns approximate bytes; caller compares against caps as a defense
 * against memory exhaustion before atob/decode. */
export function approxBase64Bytes(b64: string): number {
  const trimmed = b64.endsWith("==")
    ? b64.length - 2
    : b64.endsWith("=")
    ? b64.length - 1
    : b64.length;
  return Math.floor(trimmed * 3 / 4);
}

// POST /sessions/:id/input - Process input (non-streaming)
input.post("/:id/input", async (c) => {
  const auth = c.get("auth");
  const sessionId = parseInt(c.req.param("id"));
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return c.json({ error: "Invalid session id" }, 400);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { type, content, filename, contentType, durationSeconds, spectrogramBase64 } = body;

  // Validate input type up front so unit tests don't need DB access. Text-only
  // input goes through /task chat directly (not this endpoint) so 'text' is no
  // longer accepted here.
  const validTypes = ["obd", "photo", "audio", "video"];
  if (!validTypes.includes(type)) {
    return c.json({ error: "Invalid input type" }, 400);
  }
  if (type === "obd" && (typeof content !== "string" || !content.trim())) {
    return c.json({ error: "OBD code is required" }, 400);
  }
  if (
    (type === "photo" || type === "audio" || type === "video") &&
    (typeof content !== "string" || !content)
  ) {
    return c.json({ error: "Media content is required" }, 400);
  }
  if (
    (type === "photo" || type === "audio" || type === "video") &&
    typeof contentType === "string" &&
    !contentTypeMatches(type, contentType)
  ) {
    return c.json(
      {
        error: `contentType ${contentType} does not match input type ${type}`,
      },
      400,
    );
  }

  // F6: cap durationSeconds (audio/video billing input) and media size.
  // Without these, attackers can claim 1s for a 90s clip and undercharge
  // themselves, or send a multi-GB base64 to OOM the server.
  if (
    (type === "audio" || type === "video") &&
    typeof durationSeconds === "number" &&
    (durationSeconds < 0 || durationSeconds > MAX_DURATION_SECONDS)
  ) {
    return c.json(
      {
        error: `durationSeconds out of range`,
        message: `duration must be between 0 and ${MAX_DURATION_SECONDS} seconds`,
        max: MAX_DURATION_SECONDS,
      },
      400,
    );
  }
  if (
    (type === "photo" || type === "audio" || type === "video") &&
    typeof content === "string" &&
    approxBase64Bytes(content) > MAX_BASE64_LENGTH
  ) {
    return c.json(
      {
        error: "Media content too large",
        message: `media must be <= ${MAX_BASE64_LENGTH} base64 bytes (~37 MB raw)`,
        max: MAX_BASE64_LENGTH,
      },
      413,
    );
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

  // Charge credits for this input. Legacy HMLS customers (auth.customerId
  // set) and DEV_MODE auto-bypass inside chargeForInput. Charge BEFORE
  // persisting the media so a 402 user doesn't fill up storage with
  // rejected uploads.
  const charge = await chargeForInput({
    auth,
    kind: type as InputKind,
    sessionId,
    durationSeconds,
  });
  if (charge instanceof Response) {
    return charge;
  }
  const creditCharged = charge.charged;

  // Bump session credit counter.
  await db
    .update(schema.fixoSessions)
    .set({ creditsCharged: session.creditsCharged + creditCharged })
    .where(eq(schema.fixoSessions.id, sessionId));

  // Persist input. The chat agent on /task hydrates fixoMedia rows for the
  // session into FileUIParts when streaming a reply, so this endpoint stays
  // pure storage + bookkeeping (no LLM call here).
  let mediaId: number | null = null;
  let spectrogramMediaId: number | null = null;

  if (type === "obd") {
    await db.insert(schema.obdCodes).values({
      sessionId,
      code: content,
      source: "manual",
    });
  } else if (type === "photo" || type === "audio" || type === "video") {
    const binaryData = Uint8Array.from(
      atob(content),
      (ch) => ch.charCodeAt(0),
    );
    const uploadResult = await uploadMedia(
      binaryData,
      filename,
      contentType,
      String(sessionId),
    );

    const [mediaRow] = await db.insert(schema.fixoMedia).values({
      sessionId,
      type,
      storageKey: uploadResult.key,
      creditCost: creditCharged,
      processingStatus: "complete",
      metadata: { filename, contentType, durationSeconds },
    }).returning({ id: schema.fixoMedia.id });
    mediaId = mediaRow.id;

    // Audio: client also generates a spectrogram PNG. Persist it as its own
    // fixoMedia row so the chat agent can see it as a FileUIPart on the next
    // /task turn — Gemini analyzes the spectrogram inline (the dedicated
    // analyzeAudioNoise tool was removed; the model has the image directly).
    if (type === "audio" && spectrogramBase64) {
      const spectrogramData = Uint8Array.from(
        atob(spectrogramBase64),
        (ch) => ch.charCodeAt(0),
      );
      const spectrogramUpload = await uploadMedia(
        spectrogramData,
        `spectrogram-${filename}.png`,
        "image/png",
        String(sessionId),
      );
      const [specRow] = await db.insert(schema.fixoMedia).values({
        sessionId,
        type: "photo",
        storageKey: spectrogramUpload.key,
        creditCost: 0,
        processingStatus: "complete",
        metadata: {
          filename: `spectrogram-${filename}.png`,
          contentType: "image/png",
          spectrogramFor: mediaId,
        },
      }).returning({ id: schema.fixoMedia.id });
      spectrogramMediaId = specRow.id;
    }
  }

  return c.json({
    sessionId,
    mediaId,
    spectrogramMediaId,
    creditsCharged: creditCharged,
    sessionCreditsTotal: session.creditsCharged + creditCharged,
  });
});

// POST /sessions/:id/input/init
//
// Two-step direct upload, step 1. The client tells us what it's about to
// upload (type, filename, contentType, sizeBytes); we authenticate, validate,
// charge credits, write a `pending` fixoMedia row, and hand back a one-shot
// signed Supabase URL the client PUTs the raw file body to — bypassing the
// gateway entirely so we don't buffer tens of MB in Deno Deploy memory.
//
// Photo only for now. Audio + OBD stay on the legacy inline endpoint above
// (audio because of its paired spectrogram PNG, OBD because it's text);
// video uploads are not surfaced in the UI yet and the agent-side hydration
// would skip them anyway, so we reject them here to avoid orphaned objects.
input.post("/:id/input/init", async (c) => {
  const auth = c.get("auth");
  const sessionId = parseInt(c.req.param("id"));
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return c.json({ error: "Invalid session id" }, 400);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { type, filename, contentType, sizeBytes } = body;

  if (type !== "photo") {
    return c.json(
      { error: "Invalid input type — /input/init only accepts photo" },
      400,
    );
  }
  if (typeof filename !== "string" || !filename.trim()) {
    return c.json({ error: "filename is required" }, 400);
  }
  if (
    typeof contentType !== "string" || !contentTypeMatches(type, contentType)
  ) {
    return c.json(
      {
        error: `contentType ${contentType} does not match input type ${type}`,
      },
      400,
    );
  }
  if (
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0 ||
    !Number.isInteger(sizeBytes)
  ) {
    return c.json(
      { error: "sizeBytes is required and must be a positive integer" },
      400,
    );
  }
  if (sizeBytes > MAX_RAW_BYTES) {
    return c.json(
      {
        error: "Media content too large",
        message: `media must be <= ${MAX_RAW_BYTES} bytes`,
        max: MAX_RAW_BYTES,
      },
      413,
    );
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

  // Charge credits BEFORE issuing the signed URL — same posture as the
  // legacy inline endpoint, just earlier in the round-trip. A 402 user
  // never gets a URL and can't fill the bucket with rejected uploads.
  const charge = await chargeForInput({
    auth,
    kind: type as InputKind,
    sessionId,
  });
  if (charge instanceof Response) {
    return charge;
  }
  const creditCharged = charge.charged;

  // Bump the session counter at init time. If the client never finishes
  // the PUT and never calls /complete, credits stay spent — matches the
  // legacy inline endpoint where credits are also charged before bytes
  // land. Stale `pending` rows are harmless: hydrateSessionMedia filters
  // by processingStatus = 'complete'.
  await db
    .update(schema.fixoSessions)
    .set({ creditsCharged: session.creditsCharged + creditCharged })
    .where(eq(schema.fixoSessions.id, sessionId));

  // Use a session-scoped folder + nano-suffixed filename to avoid two
  // concurrent uploads landing on the same key. crypto.randomUUID is
  // available in Deno's standard runtime and on every modern target.
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${sessionId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeFilename}`;
  const signed = await createSignedUploadUrl(key);

  const [mediaRow] = await db
    .insert(schema.fixoMedia)
    .values({
      sessionId,
      type,
      storageKey: key,
      creditCost: creditCharged,
      processingStatus: "pending",
      metadata: { filename, contentType, sizeBytes },
    })
    .returning({ id: schema.fixoMedia.id });

  return c.json({
    mediaId: mediaRow.id,
    key,
    uploadUrl: signed.signedUrl,
    token: signed.token,
    creditsCharged: creditCharged,
    sessionCreditsTotal: session.creditsCharged + creditCharged,
  });
});

// POST /sessions/:id/input/:mediaId/complete
//
// Step 2 of the direct upload flow. The client has PUT the file to the
// signed URL from /init; this endpoint verifies the object actually landed
// in storage at the declared size and flips the fixoMedia row to `complete`
// so it becomes eligible for /task hydration.
//
// Idempotent: re-completing a row already marked `complete` is a no-op
// success. Lets the client safely retry a /complete whose response was
// lost on the wire without double-billing or erroring.
input.post("/:id/input/:mediaId/complete", async (c) => {
  const auth = c.get("auth");
  const sessionId = parseInt(c.req.param("id"));
  const mediaId = parseInt(c.req.param("mediaId"));
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return c.json({ error: "Invalid session id" }, 400);
  }
  if (!Number.isInteger(mediaId) || mediaId <= 0) {
    return c.json({ error: "Invalid media id" }, 400);
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

  const [mediaRow] = await db
    .select()
    .from(schema.fixoMedia)
    .where(
      and(
        eq(schema.fixoMedia.id, mediaId),
        eq(schema.fixoMedia.sessionId, sessionId),
      ),
    )
    .limit(1);
  if (!mediaRow) {
    return c.json({ error: "Media row not found" }, 404);
  }
  if (mediaRow.processingStatus === "complete") {
    return c.json({
      mediaId: mediaRow.id,
      sessionCreditsTotal: session.creditsCharged,
      idempotent: true,
    });
  }

  // Confirm the bytes actually arrived. Without this check, a client could
  // /init (paying credits + getting a signed URL), skip the PUT, and call
  // /complete — leaving a row marked `complete` with no backing object so
  // hydration would later fail when signing a read URL.
  const info = await getObjectInfo(mediaRow.storageKey);
  if (!info) {
    return c.json(
      {
        error: "upload_not_found",
        message: "Object was not found in storage. Retry the PUT and re-call /complete.",
      },
      409,
    );
  }

  const declaredSize = (mediaRow.metadata as { sizeBytes?: number } | null)?.sizeBytes;
  if (
    typeof declaredSize === "number" &&
    Math.abs(info.size - declaredSize) > SIZE_MISMATCH_TOLERANCE_BYTES
  ) {
    return c.json(
      {
        error: "size_mismatch",
        message: `declared sizeBytes ${declaredSize} but stored object is ${info.size} bytes`,
      },
      400,
    );
  }
  if (info.size > MAX_RAW_BYTES) {
    return c.json(
      {
        error: "Media content too large",
        message: `media must be <= ${MAX_RAW_BYTES} bytes`,
        max: MAX_RAW_BYTES,
      },
      413,
    );
  }

  await db
    .update(schema.fixoMedia)
    .set({ processingStatus: "complete" })
    .where(eq(schema.fixoMedia.id, mediaId));

  return c.json({
    mediaId,
    sessionCreditsTotal: session.creditsCharged,
  });
});

export { input };
