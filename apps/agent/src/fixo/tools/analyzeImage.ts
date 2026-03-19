import { z } from "zod";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const VISION_MODEL = "gemini-3-flash";

const analyzeImageSchema = z.object({
  imageUrl: z.string().describe("URL of the image to analyze"),
  context: z
    .string()
    .optional()
    .describe("Additional context about what to look for"),
});

export const analyzeImageTool = {
  name: "analyzeImage",
  description: "Analyze a vehicle photo for damage, wear, fluid leaks, and mechanical issues",
  schema: analyzeImageSchema,
  execute: async (params: z.infer<typeof analyzeImageSchema>) => {
    const { imageUrl, context } = params;

    const apiKey = Deno.env.get("GOOGLE_API_KEY");
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY is required");
    }

    const prompt =
      `You are an expert automotive technician. Analyze this vehicle image and identify:
- Any visible damage or wear
- Fluid leaks or stains
- Component condition (tires, brakes, belts, hoses, etc.)
- Warning signs that need attention

${context ? `Additional context: ${context}` : ""}

Provide a detailed analysis with severity ratings (low/medium/high) for any issues found.`;

    const response = await fetch(`${GEMINI_BASE_URL}chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: imageUrl },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Vision API error (${response.status}): ${text}`);
    }

    const result = await response.json();
    if (!result.choices?.length) {
      throw new Error("Vision API returned no choices");
    }
    return result.choices[0].message.content;
  },
};
