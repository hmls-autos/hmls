import { z } from "zod";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const VISION_MODEL = "gemini-2.5-flash";

const analyzeAudioNoiseSchema = z.object({
  spectrogramBase64: z
    .string()
    .describe("Base64-encoded PNG spectrogram image of the vehicle audio"),
  context: z
    .string()
    .optional()
    .describe("Additional context about the noise (when it occurs, driving conditions, etc.)"),
  durationSeconds: z
    .number()
    .optional()
    .describe("Duration of the audio recording in seconds"),
});

export const analyzeAudioNoiseTool = {
  name: "analyzeAudioNoise",
  description:
    "Analyze a vehicle sound spectrogram to diagnose mechanical issues from noise patterns (grinding, squealing, knocking, rattling, etc.)",
  schema: analyzeAudioNoiseSchema,
  execute: async (params: z.infer<typeof analyzeAudioNoiseSchema>) => {
    const { spectrogramBase64, context, durationSeconds } = params;

    const apiKey = Deno.env.get("GOOGLE_API_KEY");
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY is required");
    }

    const prompt =
      `You are an expert automotive sound diagnostician analyzing a spectrogram of a vehicle noise recording.${
        durationSeconds ? ` Recording duration: ${durationSeconds} seconds.` : ""
      }

## How to Read This Spectrogram
- X-axis = time (seconds), Y-axis = frequency (Hz), color intensity = amplitude
- Brighter/warmer colors indicate louder sound energy at that frequency and time

## Frequency Band Analysis Guide
- **20-200 Hz**: Engine rumble, exhaust drone, drivetrain vibration
- **200-500 Hz**: Wheel bearing hum, transmission whine, power steering pump
- **500-1500 Hz**: Belt squeal, brake pad wear indicators, alternator whine
- **1500-4000 Hz**: Metallic grinding, valve train noise, injector ticking
- **4000-8000 Hz**: High-pitched squeals, brake dust shields, serpentine belt chirp

## Temporal Pattern Analysis
- **Constant tone**: Bearing failure, belt slip, exhaust leak
- **Rhythmic/periodic**: Engine knock (RPM-linked), tire flat spot, CV joint click
- **Intermittent**: Loose heat shield, worn bushing, suspension clunk
- **Speed-dependent**: Wheel bearing (changes with speed), tire noise, drivetrain

## Harmonic Structure
- **Single frequency line**: Electrical/mechanical resonance (alternator, pump)
- **Harmonic series**: Engine-order vibration, exhaust resonance
- **Broadband noise**: Friction (brakes grinding), air leak, turbulence

${context ? `Additional context from the vehicle owner: ${context}` : ""}

Analyze the spectrogram and provide:
1. **Sound Type**: What kind of noise is shown (grinding, squealing, knocking, humming, rattling, etc.)
2. **Frequency Characteristics**: Key frequency bands with significant energy
3. **Temporal Pattern**: How the sound changes over time
4. **Likely Source**: Most probable mechanical source(s)
5. **Confidence**: How confident you are in the diagnosis (low/medium/high)
6. **Severity**: How urgent this is (low/medium/high/critical)
7. **Recommended Action**: What the vehicle owner should do next`;

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
                image_url: { url: `data:image/png;base64,${spectrogramBase64}` },
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

    const result = await response.json();
    return result.choices[0].message.content;
  },
};
