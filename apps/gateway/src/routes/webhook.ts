import { Hono } from "hono";
import Stripe from "stripe";

// Stripe webhook — currently dormant.
//
// After Layer 3 (orders absorbed bookings, and we dropped the
// stripe_invoice_id / stripe_payment_intent_id columns), no code flow creates
// Stripe payment intents or invoices. The webhook endpoint still exists so
// Stripe's dashboard test fires don't 404, but it no longer mutates any data.
//
// When a shop opts into Stripe auto-capture, restore the handlers to
// transition the order's `paidAt` / `paymentMethod` / `capturedAmountCents`.
export function createWebhookRoute(stripeSecretKey: string) {
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2026-02-25.clover",
  });

  const webhook = new Hono();

  webhook.post("/stripe", async (c) => {
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("[webhook] STRIPE_WEBHOOK_SECRET not set");
      return c.json({ error: "Webhook not configured" }, 500);
    }

    const signature = c.req.header("stripe-signature");
    if (!signature) {
      return c.json({ error: "Missing stripe-signature header" }, 400);
    }

    let event: Stripe.Event;
    try {
      const body = await c.req.text();
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret,
      ) as Stripe.Event;
    } catch (err) {
      console.error("[webhook] Signature verification failed:", err);
      return c.json({ error: "Invalid signature" }, 400);
    }

    console.log(
      `[webhook] Received event (no-op): ${event.type} (${event.id})`,
    );
    return c.json({ received: true, note: "Stripe flow dormant" });
  });

  return webhook;
}
