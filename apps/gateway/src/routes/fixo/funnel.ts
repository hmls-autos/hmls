// Public funnel-event beacon endpoint for fixo推广 channel attribution.
//
// Called by:
//   - /obd/[code] SEO landing pages (client-side fetch on page mount)
//   - HMLS rejection emails (redirect through this endpoint, then 302
//     onward to fixo.ink, so we capture the click before the user arrives)
//   - TikTok creator deep links (UTM params → POST → redirect)
//
// Public on purpose — no auth required because SEO and email-CTA hits
// happen before sign-in. The endpoint validates the event_name and
// channel are sane (whitelist), rejects oversized metadata, and ignores
// any user_id the client supplies (server-side auth context wins if
// present; otherwise userId stays null and gets back-filled later by
// joining on the most recent fingerprint or device cookie).

import { Hono } from "hono";
import { z } from "zod";
import { getLogger } from "@logtape/logtape";
import { recordFunnelEvent } from "@hmls/agent";
import type { AuthContext } from "../../middleware/fixo/auth.ts";
import { authenticateRequest } from "../../middleware/fixo/auth.ts";

const logger = getLogger(["hmls", "gateway", "fixo", "funnel"]);

const trackSchema = z.object({
  event_name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "lowercase alphanumeric + underscore only"),
  channel: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_]+$/, "lowercase alphanumeric + underscore only"),
  channel_detail: z.string().max(128).optional(),
  session_id: z.number().int().positive().optional(),
  // Limit metadata size; jsonb column on Postgres has practical limits and
  // we don't want clients sending megabytes.
  metadata: z.record(z.string(), z.unknown()).optional()
    .refine((m) => !m || JSON.stringify(m).length < 4096, {
      message: "metadata too large (max 4KB serialized)",
    }),
});

export const funnel = new Hono<{ Variables: { auth?: AuthContext } }>();

funnel.post("/track", async (c) => {
  // Optional auth: if the request carries a valid session, attribute the
  // event to that user. Otherwise it's an anonymous beacon.
  let userId: string | null = null;
  const authResult = await authenticateRequest(c.req.raw);
  if (!(authResult instanceof Response)) {
    userId = authResult.userId;
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = trackSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("funnel track validation failed", {
      issues: parsed.error.issues,
    });
    return c.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      400,
    );
  }

  await recordFunnelEvent({
    eventName: parsed.data.event_name,
    channel: parsed.data.channel,
    channelDetail: parsed.data.channel_detail,
    userId,
    sessionId: parsed.data.session_id,
    metadata: parsed.data.metadata,
  });

  return c.json({ recorded: true }, 202);
});
