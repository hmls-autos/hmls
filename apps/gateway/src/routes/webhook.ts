import { env } from "@hmls/shared/env";
import { Hono } from "hono";
import Stripe from "stripe";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["hmls", "gateway", "webhook"]);

// Stripe webhook — currently dormant.
//
// After Layer 3 (orders absorbed bookings, and we dropped the
// stripe_invoice_id / stripe_payment_intent_id columns), no code flow creates
// Stripe payment intents or invoices. The webhook endpoint still exists so
// Stripe's dashboard test fires don't 404, but it no longer mutates any data.
//
// When a shop opts into Stripe auto-capture, restore the handlers to
// transition the order's `paidAt` / `paymentMethod` / `paidAmountCents`.
//
// Keys are read per request, not at mount: on workerd the app is composed at
// module init, where env() can't resolve yet (C3 in
// docs/cloudflare-migration.md).
export function createWebhookRoute() {
  const webhook = new Hono();

  webhook.post("/stripe", async (c) => {
    const stripeSecretKey = env("STRIPE_SECRET_KEY");
    const webhookSecret = env("STRIPE_WEBHOOK_SECRET");
    if (!stripeSecretKey || !webhookSecret) {
      logger.error("STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set");
      return c.json({ error: "Webhook not configured" }, 500);
    }
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2026-02-25.clover",
    });

    const signature = c.req.header("stripe-signature");
    if (!signature) {
      return c.json({ error: "Missing stripe-signature header" }, 400);
    }

    let event: Stripe.Event;
    try {
      const body = await c.req.text();
      // Async variant uses Web Crypto — the sync constructEvent does node
      // crypto synchronously, which throws on workerd.
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        webhookSecret,
      ) as Stripe.Event;
    } catch (err) {
      logger.error("Signature verification failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ error: "Invalid signature" }, 400);
    }

    logger.info("Received event (no-op) {eventType} {eventId}", {
      eventType: event.type,
      eventId: event.id,
    });
    return c.json({ received: true, note: "Stripe flow dormant" });
  });

  return webhook;
}
