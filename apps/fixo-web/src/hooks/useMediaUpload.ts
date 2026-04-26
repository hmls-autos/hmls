import { type MutableRefObject, useCallback } from "react";

import { AGENT_URL } from "@/lib/config";
import { ensureSession } from "@/lib/session";

interface UseMediaUploadOptions {
  accessToken: string | undefined;
  sessionIdRef: MutableRefObject<number | null>;
  sendMessage: (text: string, meta?: { imageUrl?: string }) => void;
}

async function uploadMedia(
  accessToken: string,
  sessionId: number,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${AGENT_URL}/sessions/${sessionId}/input`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export function useMediaUpload({
  accessToken,
  sessionIdRef,
  sendMessage,
}: UseMediaUploadOptions) {
  const handleAudioSend = useCallback(
    async (recording: {
      base64: string;
      spectrogramBase64?: string;
      durationSeconds: number;
    }) => {
      if (!accessToken) return;

      const sessionId = await ensureSession(accessToken, sessionIdRef);
      if (!sessionId) {
        sendMessage("[Audio recording failed to upload]");
        return;
      }

      const res = await uploadMedia(accessToken, sessionId, {
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
      } else {
        sendMessage("[Audio upload failed — please try again]");
      }
    },
    [accessToken, sessionIdRef, sendMessage],
  );

  const handlePhotoCapture = useCallback(
    async (dataUrl: string) => {
      if (!accessToken) return;

      const base64 = dataUrl.split(",")[1];
      const sessionId = await ensureSession(accessToken, sessionIdRef);
      if (!sessionId) {
        sendMessage("[Photo upload failed]");
        return;
      }

      const res = await uploadMedia(accessToken, sessionId, {
        type: "photo",
        content: base64,
        filename: `photo-${Date.now()}.jpg`,
        contentType: "image/jpeg",
      });

      if (res.ok) {
        // Server hydrates the photo into the next /task turn as a FileUIPart.
        // imageUrl is preserved so MessageBubble can render the local
        // preview without waiting on a round-trip to the signed URL.
        sendMessage("Analyze this photo for vehicle diagnostics.", {
          imageUrl: dataUrl,
        });
      } else {
        sendMessage("[Photo upload failed — please try again]");
      }
    },
    [accessToken, sessionIdRef, sendMessage],
  );

  const handleFilePick = useCallback(
    (file: File) => {
      if (!accessToken) return;

      if (file.size > 10 * 1024 * 1024) {
        sendMessage("[Photo too large — maximum 10MB]");
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];

        const sessionId = await ensureSession(accessToken, sessionIdRef);
        if (!sessionId) {
          sendMessage("[Photo upload failed]");
          return;
        }

        const res = await uploadMedia(accessToken, sessionId, {
          type: "photo",
          content: base64,
          filename: file.name,
          contentType: file.type || "image/jpeg",
        });

        if (res.ok) {
          sendMessage("Analyze this photo for vehicle diagnostics.", {
            imageUrl: dataUrl,
          });
        } else {
          sendMessage("[Photo upload failed — please try again]");
        }
      };
      reader.readAsDataURL(file);
    },
    [accessToken, sessionIdRef, sendMessage],
  );

  return { handleAudioSend, handlePhotoCapture, handleFilePick };
}
