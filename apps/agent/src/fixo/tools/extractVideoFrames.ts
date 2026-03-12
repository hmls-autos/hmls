import { z } from "zod";
import { getMedia, uploadMedia } from "../lib/storage.ts";
import { toolResult } from "@hmls/shared/tool-result";

const extractVideoFramesSchema = z.object({
  storageKey: z.string().describe("Storage key for the video file"),
  sessionId: z.string().describe("Session ID for storing extracted frames"),
  frameCount: z
    .number()
    .default(5)
    .describe("Number of frames to extract (default 5)"),
});

export const extractVideoFramesTool = {
  name: "extractVideoFrames",
  description: "Extract key frames from a video for visual analysis",
  schema: extractVideoFramesSchema,
  execute: async (params: z.infer<typeof extractVideoFramesSchema>) => {
    const { storageKey, sessionId, frameCount } = params;

    const videoData = await getMedia(storageKey);

    // Write to temp file for ffmpeg
    const tempInput = await Deno.makeTempFile({ suffix: ".mp4" });
    const tempOutput = await Deno.makeTempDir();

    try {
      await Deno.writeFile(tempInput, videoData);

      // Extract frames with ffmpeg
      const command = new Deno.Command("ffmpeg", {
        args: [
          "-i",
          tempInput,
          "-vf",
          `fps=1/${Math.ceil(30 / frameCount)}`, // Distribute frames across ~30s
          "-frames:v",
          String(frameCount),
          `${tempOutput}/frame_%03d.jpg`,
        ],
      });

      const { code } = await command.output();
      if (code !== 0) {
        throw new Error("ffmpeg failed to extract frames");
      }

      // Upload extracted frames
      const frameKeys: string[] = [];
      for (let i = 1; i <= frameCount; i++) {
        const framePath = `${tempOutput}/frame_${String(i).padStart(3, "0")}.jpg`;
        try {
          const frameData = await Deno.readFile(framePath);
          const result = await uploadMedia(
            frameData,
            `frame_${i}.jpg`,
            "image/jpeg",
            sessionId,
          );
          frameKeys.push(result.key);
        } catch {
          // Frame might not exist if video is shorter
          break;
        }
      }

      return toolResult({
        frameCount: frameKeys.length,
        frameKeys,
        message: `Extracted ${frameKeys.length} frames from video`,
      });
    } finally {
      // Cleanup temp files
      await Deno.remove(tempInput);
      await Deno.remove(tempOutput, { recursive: true });
    }
  },
};
