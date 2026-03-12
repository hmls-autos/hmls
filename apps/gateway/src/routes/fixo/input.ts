import { Hono } from "hono";
import { eachValueFrom } from "rxjs-for-await";
import { db, schema } from "@hmls/agent/db";
import { eq } from "drizzle-orm";
import { getAgent, type InputType, uploadMedia } from "@hmls/agent";
import { processCredits } from "../../middleware/diagnostic/credits.ts";
import { checkFreeTierLimit } from "../../middleware/diagnostic/tier.ts";
import { createAguiEventStream } from "@zypher/agui";
import type { AuthContext } from "../../middleware/diagnostic/auth.ts";

type Variables = { auth: AuthContext };

const input = new Hono<{ Variables: Variables }>();

// POST /diagnostics/:id/input - Process input (non-streaming)
input.post("/:id/input", async (c) => {
  const auth = c.get("auth");
  const sessionId = parseInt(c.req.param("id"));

  const [session] = await db
    .select()
    .from(schema.diagnosticSessions)
    .where(eq(schema.diagnosticSessions.id, sessionId))
    .limit(1);

  if (
    !session ||
    (session.userId !== auth.userId && session.customerId !== auth.customerId)
  ) {
    return c.json({ error: "Session not found" }, 404);
  }

  const body = await c.req.json();
  const { type, content, filename, contentType, durationSeconds, spectrogramBase64 } = body;

  // Validate input type
  const validTypes = ["text", "obd", "photo", "audio", "video"];
  if (!validTypes.includes(type)) {
    return c.json({ error: "Invalid input type" }, 400);
  }

  // Check free tier limits for SaaS users (non-legacy)
  if (!auth.customerId) {
    const tierBlock = await checkFreeTierLimit(auth, type);
    if (tierBlock) return tierBlock;
  }

  // Check and deduct credits (only for legacy customers with Stripe)
  let creditCharged = 0;
  if (auth.stripeCustomerId && auth.customerId) {
    const creditResult = await processCredits(
      auth.stripeCustomerId,
      type as InputType,
      sessionId,
      durationSeconds,
    );
    if (creditResult instanceof Response) {
      return creditResult;
    }
    creditCharged = creditResult.charged;
  }

  // Update session
  await db
    .update(schema.diagnosticSessions)
    .set({
      creditsCharged: session.creditsCharged + creditCharged,
      status: "processing",
    })
    .where(eq(schema.diagnosticSessions.id, sessionId));

  // Handle different input types
  let agentInput: string;

  if (type === "text") {
    agentInput = content;
  } else if (type === "obd") {
    await db.insert(schema.obdCodes).values({
      sessionId,
      code: content,
      source: "manual",
    });
    agentInput = `OBD-II Code: ${content}`;
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

    // Upload spectrogram PNG alongside audio if provided
    let spectrogramUrl: string | undefined;
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
      spectrogramUrl = spectrogramUpload.url;
    }

    await db.insert(schema.diagnosticMedia).values({
      sessionId,
      type: type === "photo" ? "photo" : type === "audio" ? "audio" : "video",
      storageKey: uploadResult.key,
      creditCost: creditCharged,
      metadata: { filename, contentType, durationSeconds },
    });

    if (type === "audio" && spectrogramBase64) {
      // For audio: trigger spectrogram-based noise analysis
      agentInput = `[AUDIO uploaded: ${filename}, duration: ${
        durationSeconds ?? "unknown"
      }s] A spectrogram has been generated from this vehicle sound recording. Use the analyzeAudioNoise tool with the following spectrogram data to diagnose the sound. Spectrogram base64: ${spectrogramBase64}`;
    } else {
      agentInput = `[${type.toUpperCase()} uploaded: ${filename}] URL: ${uploadResult.url}`;
    }
    void spectrogramUrl;
  } else {
    agentInput = content;
  }

  // Use AG-UI stream but collect final response
  const agentInstance = await getAgent();
  const messageId = crypto.randomUUID();
  const aguiStream = createAguiEventStream({
    agent: agentInstance,
    messages: [{ id: messageId, role: "user", content: agentInput }],
    threadId: `session-${sessionId}`,
    runId: crypto.randomUUID(),
  });

  // Collect the final text response
  let responseText = "";
  for await (const event of eachValueFrom(aguiStream)) {
    // Type assertion for events with delta property
    const evt = event as { type: string; delta?: string };
    if (evt.type === "TEXT_MESSAGE_CONTENT" && evt.delta) {
      responseText += evt.delta;
    }
  }

  return c.json({
    response: responseText,
    creditsCharged: creditCharged,
    sessionCreditsTotal: session.creditsCharged + creditCharged,
  });
});

export { input };
