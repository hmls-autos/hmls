import { z } from "zod";
import { getMedia, uploadMedia } from "../lib/storage.ts";
import { toolResult } from "@hmls/shared/tool-result";

const saveMediaSchema = z.object({
  data: z.string().describe("Base64-encoded media data"),
  filename: z.string().describe("Filename for the media"),
  contentType: z.string().describe("MIME type of the media"),
  sessionId: z.string().describe("Session ID for organizing storage"),
});

const getMediaSchema = z.object({
  storageKey: z.string().describe("Storage key for the media file"),
});

export const saveMediaTool = {
  name: "saveMedia",
  description: "Save uploaded media (photo, audio, video) to cloud storage",
  schema: saveMediaSchema,
  execute: async (params: z.infer<typeof saveMediaSchema>) => {
    const { data, filename, contentType, sessionId } = params;

    // Decode base64 to Uint8Array
    const binaryData = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

    const result = await uploadMedia(
      binaryData,
      filename,
      contentType,
      sessionId,
    );

    return toolResult({
      success: true,
      storageKey: result.key,
      url: result.url,
    });
  },
};

export const getMediaTool = {
  name: "getMedia",
  description: "Retrieve media from cloud storage",
  schema: getMediaSchema,
  execute: async (params: z.infer<typeof getMediaSchema>) => {
    const { storageKey } = params;

    const data = await getMedia(storageKey);

    return toolResult({
      success: true,
      data: btoa(String.fromCharCode(...data)),
      size: data.length,
    });
  },
};
