import { type MutableRefObject, useCallback } from "react";

import { AGENT_URL } from "@/lib/config";
import { ensureSession } from "@/lib/session";

interface UseMediaUploadOptions {
  accessToken: string | undefined;
  sessionIdRef: MutableRefObject<number | null>;
  sendMessage: (text: string, meta?: { imageUrl?: string }) => void;
  /** Authenticated user id, scopes the persisted session id so a sign-out/
   * sign-in on the same browser doesn't reuse the previous account's id. */
  userId: string | null | undefined;
  /** Out-of-credits responses (402 insufficient_credits, also legacy 403
   * upgrade_required during the rollout window) are surfaced to the same
   * upgrade/top-up modal the chat flow uses, instead of a generic
   * "upload failed" toast. */
  onUpgradeRequired?: (message: string) => void;
}

// Matches MAX_RAW_BYTES on the gateway. Kept in sync manually because
// crossing the Deno↔Bun runtime boundary for a single int isn't worth the
// shared-package overhead.
const MAX_RAW_BYTES = 37 * 1024 * 1024;

async function postJson(
  accessToken: string,
  url: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** When an upload is blocked by credits (402 insufficient_credits, or the
 * legacy 403 upgrade_required / limit_reached during rollout), route the
 * error message to the upgrade/top-up modal. Returns true if handled so
 * the caller skips the generic failure toast. */
async function tryHandleTierBlock(
  res: Response,
  onUpgradeRequired: ((message: string) => void) | undefined,
): Promise<boolean> {
  if (!onUpgradeRequired) return false;
  if (res.status !== 402 && res.status !== 403) return false;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    const isCreditBlock =
      body?.error === "insufficient_credits" ||
      body?.error === "upgrade_required" ||
      body?.error === "limit_reached";
    if (!isCreditBlock) return false;
    onUpgradeRequired(
      typeof body.message === "string" && body.message.length > 0
        ? body.message
        : "Not enough credits — upgrade to Plus or top up to continue.",
    );
    return true;
  } catch {
    /* fall through to generic error */
  }
  return false;
}

interface DirectUploadInput {
  accessToken: string;
  sessionId: number;
  blob: Blob;
  filename: string;
  contentType: string;
  type: "photo";
}

/** Three-step direct-to-Supabase upload: /input/init → PUT to signed URL →
 * /input/:mediaId/complete. Returns { ok: true } on success, or { ok: false,
 * tierBlocked } when the failure was already surfaced via the upgrade modal
 * so the caller knows to skip its generic toast. */
async function uploadDirect(
  input: DirectUploadInput,
  onUpgradeRequired: ((message: string) => void) | undefined,
): Promise<{ ok: true } | { ok: false; tierBlocked: boolean }> {
  const initRes = await postJson(
    input.accessToken,
    `${AGENT_URL}/sessions/${input.sessionId}/input/init`,
    {
      type: input.type,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.blob.size,
    },
  );
  if (!initRes.ok) {
    const tierBlocked = await tryHandleTierBlock(initRes, onUpgradeRequired);
    return { ok: false, tierBlocked };
  }
  const init = (await initRes.json()) as { mediaId: number; uploadUrl: string };

  // PUT raw bytes directly to Supabase — gateway never sees the body.
  const putRes = await fetch(init.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": input.contentType },
    body: input.blob,
  });
  if (!putRes.ok) {
    return { ok: false, tierBlocked: false };
  }

  const completeRes = await postJson(
    input.accessToken,
    `${AGENT_URL}/sessions/${input.sessionId}/input/${init.mediaId}/complete`,
    {},
  );
  if (!completeRes.ok) {
    return { ok: false, tierBlocked: false };
  }
  return { ok: true };
}

async function uploadAudioInline(
  accessToken: string,
  sessionId: number,
  body: Record<string, unknown>,
): Promise<Response> {
  return postJson(
    accessToken,
    `${AGENT_URL}/sessions/${sessionId}/input`,
    body,
  );
}

export function useMediaUpload({
  accessToken,
  sessionIdRef,
  sendMessage,
  userId,
  onUpgradeRequired,
}: UseMediaUploadOptions) {
  const handleAudioSend = useCallback(
    async (recording: {
      base64: string;
      spectrogramBase64?: string;
      durationSeconds: number;
    }) => {
      if (!accessToken) return;

      const sessionId = await ensureSession(accessToken, sessionIdRef, userId);
      if (!sessionId) {
        sendMessage("[Audio recording failed to upload]");
        return;
      }

      // Audio stays on the inline endpoint: it's small (a 60s webm is ~1MB)
      // and the client-generated spectrogram PNG ships in the same request
      // so the agent gets both rows as one atomic write.
      const res = await uploadAudioInline(accessToken, sessionId, {
        type: "audio",
        content: recording.base64,
        spectrogramBase64: recording.spectrogramBase64,
        filename: `recording-${Date.now()}.webm`,
        contentType: "audio/webm",
        durationSeconds: recording.durationSeconds,
      });

      if (res.ok) {
        // Server hydrates the spectrogram into the next /task turn as a
        // FileUIPart, so the chat message is just the user's intent.
        sendMessage(
          `Analyze this ${recording.durationSeconds}s vehicle sound recording.`,
        );
        return;
      }
      if (await tryHandleTierBlock(res, onUpgradeRequired)) return;
      sendMessage("[Audio upload failed — please try again]");
    },
    [accessToken, sessionIdRef, sendMessage, userId, onUpgradeRequired],
  );

  const handlePhotoCapture = useCallback(
    async (dataUrl: string) => {
      if (!accessToken) return;

      const sessionId = await ensureSession(accessToken, sessionIdRef, userId);
      if (!sessionId) {
        sendMessage("[Photo upload failed]");
        return;
      }

      // dataUrl → Blob via fetch() is the cheapest cross-browser path and
      // avoids the ~33% base64 inflation of the old JSON-body approach.
      const blob = await (await fetch(dataUrl)).blob();
      const result = await uploadDirect(
        {
          accessToken,
          sessionId,
          blob,
          filename: `photo-${Date.now()}.jpg`,
          contentType: blob.type || "image/jpeg",
          type: "photo",
        },
        onUpgradeRequired,
      );

      if (result.ok) {
        // imageUrl preserves the local preview so MessageBubble can render
        // immediately without waiting on a signed read URL round-trip.
        sendMessage("Analyze this photo for vehicle diagnostics.", {
          imageUrl: dataUrl,
        });
        return;
      }
      if (result.tierBlocked) return;
      sendMessage("[Photo upload failed — please try again]");
    },
    [accessToken, sessionIdRef, sendMessage, userId, onUpgradeRequired],
  );

  const handleFilePick = useCallback(
    async (file: File) => {
      if (!accessToken) return;

      // Reject obvious non-images, but accept files with empty mime type —
      // macOS HEIC/AVIF photos picked through `accept="image/*"` often
      // arrive with `file.type === ""`, and the OS-level filter already
      // gated against non-images. Empty type falls back to image/jpeg in
      // the upload metadata; the model handles the actual decoding.
      if (file.type && !file.type.startsWith("image/")) {
        sendMessage("[Unsupported file type — pick an image]");
        return;
      }
      if (file.size > MAX_RAW_BYTES) {
        const mb = Math.floor(MAX_RAW_BYTES / (1024 * 1024));
        sendMessage(`[Photo too large — maximum ${mb}MB]`);
        return;
      }

      const sessionId = await ensureSession(accessToken, sessionIdRef, userId);
      if (!sessionId) {
        sendMessage("[Photo upload failed]");
        return;
      }

      const previewUrl = await readAsDataUrl(file);

      const result = await uploadDirect(
        {
          accessToken,
          sessionId,
          blob: file,
          filename: file.name,
          contentType: file.type || "image/jpeg",
          type: "photo",
        },
        onUpgradeRequired,
      );

      if (result.ok) {
        sendMessage("Analyze this photo for vehicle diagnostics.", {
          imageUrl: previewUrl,
        });
        return;
      }
      if (result.tierBlocked) return;
      sendMessage("[Photo upload failed — please try again]");
    },
    [accessToken, sessionIdRef, sendMessage, userId, onUpgradeRequired],
  );

  return { handleAudioSend, handlePhotoCapture, handleFilePick };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
