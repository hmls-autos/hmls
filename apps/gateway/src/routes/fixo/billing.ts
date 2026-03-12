import { Hono } from "hono";
import type Stripe from "stripe";
import type { AuthContext } from "../../middleware/diagnostic/auth.ts";
import {
  createCheckoutSession,
  createPortalSession,
  handleSubscriptionWebhook,
  stripe,
} from "@hmls/agent";

type Variables = { auth: AuthContext };

const billing = new Hono<{ Variables: Variables }>();

// POST /billing/checkout — create Stripe Checkout session
billing.post("/checkout", async (c) => {
  const auth = c.get("auth");

  try {
    const body = await c.req.json();
    const successUrl = body.successUrl || `${c.req.header("origin") || ""}/chat?upgraded=true`;
    const cancelUrl = body.cancelUrl || `${c.req.header("origin") || ""}/pricing`;

    const checkoutUrl = await createCheckoutSession(
      auth.userId,
      auth.email,
      successUrl,
      cancelUrl,
    );

    return c.json({ url: checkoutUrl });
  } catch (err) {
    console.error("[billing] Checkout error:", err);
    return c.json({ error: "Failed to create checkout session" }, 500);
  }
});

// GET /billing/portal — redirect to Stripe Customer Portal
billing.get("/portal", async (c) => {
  const auth = c.get("auth");

  if (!auth.stripeCustomerId) {
    return c.json({ error: "No billing account found" }, 404);
  }

  try {
    const returnUrl = `${c.req.header("origin") || ""}/settings`;
    const portalUrl = await createPortalSession(
      auth.stripeCustomerId,
      returnUrl,
    );
    return c.json({ url: portalUrl });
  } catch (err) {
    console.error("[billing] Portal error:", err);
    return c.json({ error: "Failed to create portal session" }, 500);
  }
});

// POST /billing/webhook — handle Stripe webhooks (no auth required)
const webhookHandler = new Hono();

webhookHandler.post("/", async (c) => {
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!webhookSecret) {
    console.error("[billing] STRIPE_WEBHOOK_SECRET not set");
    return c.json({ error: "Webhook not configured" }, 500);
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "Missing signature" }, 400);
  }

  try {
    const body = await c.req.text();
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret,
    ) as Stripe.Event;

    await handleSubscriptionWebhook(event);
    return c.json({ received: true });
  } catch (err) {
    console.error("[billing] Webhook error:", err);
    return c.json({ error: "Webhook verification failed" }, 400);
  }
});

export { billing, webhookHandler };
