import { Hono } from "hono";
import type Stripe from "stripe";
import { getLogger } from "@logtape/logtape";
import type { AuthContext } from "../../middleware/fixo/auth.ts";
import {
  createCheckoutSession,
  createPortalSession,
  createTopupCheckoutSession,
  CREDIT_COSTS,
  creditsForUsd,
  getBalance,
  handleSubscriptionWebhook,
  stripe,
  SUGGESTED_TOPUPS_USD,
  TOPUP_CENTS_PER_CREDIT,
  TOPUP_MAX_USD,
  TOPUP_MIN_USD,
} from "@hmls/agent";

const logger = getLogger(["hmls", "gateway", "fixo", "billing"]);

type Variables = { auth: AuthContext };

const billing = new Hono<{ Variables: Variables }>();

/**
 * Reject legacy HMLS customers (auth.customerId set) from the billing
 * surface. Legacy customers don't have a `user_profiles` row, so:
 *   - createCheckoutSession's UPDATE user_profiles is a silent no-op
 *   - the Stripe webhook can't find them by stripe_customer_id
 *   - they pay Stripe and get nothing back
 * Better to fail fast with 403 than silently take their money. (F3 fix
 * from prior review.)
 */
function rejectLegacyCustomer(auth: AuthContext): Response | null {
  if (auth.customerId !== undefined) {
    return new Response(
      JSON.stringify({
        error: "legacy_customer",
        message:
          "Legacy customer accounts can't manage credits self-serve. Contact support to migrate.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  return null;
}

// POST /billing/checkout — create Stripe subscription Checkout session (Plus)
billing.post("/checkout", async (c) => {
  const auth = c.get("auth");
  const block = rejectLegacyCustomer(auth);
  if (block) return block;

  try {
    const body = await c.req.json();
    const successUrl = body.successUrl ||
      `${c.req.header("origin") || ""}/chat?upgraded=true`;
    const cancelUrl = body.cancelUrl ||
      `${c.req.header("origin") || ""}/pricing`;

    const checkoutUrl = await createCheckoutSession(
      auth.userId,
      auth.email,
      successUrl,
      cancelUrl,
    );

    return c.json({ url: checkoutUrl });
  } catch (err) {
    logger.error("Checkout error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.json({ error: "Failed to create checkout session" }, 500);
  }
});

// POST /billing/topup — create Stripe Checkout for a one-time credit purchase
// at the flat $1 = 100cr rate. Body: { dollars: integer, successUrl?, cancelUrl? }
billing.post("/topup", async (c) => {
  const auth = c.get("auth");
  const block = rejectLegacyCustomer(auth);
  if (block) return block;

  let body: { dollars?: unknown; successUrl?: string; cancelUrl?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const dollars = Number(body.dollars);
  if (
    !Number.isFinite(dollars) ||
    !Number.isInteger(dollars) ||
    dollars < TOPUP_MIN_USD ||
    dollars > TOPUP_MAX_USD
  ) {
    return c.json(
      {
        error: "Invalid dollars",
        message: `dollars must be an integer between ${TOPUP_MIN_USD} and ${TOPUP_MAX_USD}`,
        min: TOPUP_MIN_USD,
        max: TOPUP_MAX_USD,
      },
      400,
    );
  }

  try {
    const successUrl = body.successUrl ||
      `${c.req.header("origin") || ""}/chat?topped_up=true`;
    const cancelUrl = body.cancelUrl ||
      `${c.req.header("origin") || ""}/settings`;

    const checkoutUrl = await createTopupCheckoutSession({
      userId: auth.userId,
      email: auth.email,
      dollars,
      successUrl,
      cancelUrl,
    });

    return c.json({
      url: checkoutUrl,
      credits: creditsForUsd(dollars),
      dollars,
    });
  } catch (err) {
    logger.error("Topup error", {
      dollars,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.json({ error: "Failed to create top-up session" }, 500);
  }
});

// GET /billing/balance — return current credit state + pricing reference
billing.get("/balance", async (c) => {
  const auth = c.get("auth");
  // Pricing block is the same regardless of caller — clients use it to
  // render the top-up modal without a separate fetch.
  const pricing = {
    costs: CREDIT_COSTS,
    topupCentsPerCredit: TOPUP_CENTS_PER_CREDIT,
    suggestedTopupsUsd: SUGGESTED_TOPUPS_USD,
    minUsd: TOPUP_MIN_USD,
    maxUsd: TOPUP_MAX_USD,
  };
  // Legacy customers don't carry a balance (they bypass credits). Return
  // a sentinel envelope so the client can render an "unlimited" badge.
  if (auth.customerId) {
    return c.json({
      unlimited: true,
      monthly: 0,
      topup: 0,
      total: null,
      tier: auth.tier,
      ...pricing,
    });
  }
  const balance = await getBalance(auth.userId);
  return c.json({
    unlimited: false,
    monthly: balance.monthly,
    topup: balance.topup,
    total: balance.total,
    tier: auth.tier,
    ...pricing,
  });
});

// GET /billing/portal — redirect to Stripe Customer Portal
billing.get("/portal", async (c) => {
  const auth = c.get("auth");
  const block = rejectLegacyCustomer(auth);
  if (block) return block;

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
    logger.error("Portal error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.json({ error: "Failed to create portal session" }, 500);
  }
});

// POST /billing/webhook — handle Stripe webhooks (no auth required)
const webhookHandler = new Hono();

webhookHandler.post("/", async (c) => {
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!webhookSecret) {
    logger.error("STRIPE_WEBHOOK_SECRET not set");
    return c.json({ error: "Webhook not configured" }, 500);
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "Missing signature" }, 400);
  }

  try {
    const body = await c.req.text();
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
    ) as Stripe.Event;

    await handleSubscriptionWebhook(event);
    return c.json({ received: true });
  } catch (err) {
    logger.error("Webhook error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.json({ error: "Webhook verification failed" }, 400);
  }
});

export { billing, webhookHandler };
