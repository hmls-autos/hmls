import Stripe from "stripe";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is required");
    }
    _stripe = new Stripe(secretKey);
  }
  return _stripe;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripe();
    const value = client[prop as keyof typeof client];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

// Credit costs per input type
export const CREDIT_COSTS = {
  text: 1,
  obd: 1,
  photo: 2,
  audio: 5, // per 30s
  video: 10, // per 30s
} as const;

export type InputType = keyof typeof CREDIT_COSTS;

export async function getCustomerCredits(
  stripeCustomerId: string,
): Promise<number> {
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (customer.deleted) {
    throw new Error("Customer not found");
  }
  // Credits stored as balance in cents (1 credit = 1 cent for simplicity)
  return Math.floor((customer.balance ?? 0) / -1); // Negative balance = available credits
}

export async function deductCredits(
  stripeCustomerId: string,
  amount: number,
  description: string,
): Promise<void> {
  await stripe.customers.createBalanceTransaction(stripeCustomerId, {
    amount: amount, // Positive = deduct (increase balance owed)
    currency: "usd",
    description,
  });
}

export async function addCredits(
  stripeCustomerId: string,
  amount: number,
  description: string,
): Promise<void> {
  await stripe.customers.createBalanceTransaction(stripeCustomerId, {
    amount: -amount, // Negative = add credits (decrease balance owed)
    currency: "usd",
    description,
  });
}

export function calculateAudioCredits(durationSeconds: number): number {
  return Math.ceil(durationSeconds / 30) * CREDIT_COSTS.audio;
}

export function calculateVideoCredits(durationSeconds: number): number {
  return Math.ceil(durationSeconds / 30) * CREDIT_COSTS.video;
}

// --- Subscription helpers ---

export async function getStripeCustomerIdForUser(
  userId: string,
): Promise<string | null> {
  const { db } = await import("../../db/client.ts");
  const { userProfiles } = await import("../../db/schema.ts");
  const { eq } = await import("drizzle-orm");

  const [profile] = await db
    .select({ stripeCustomerId: userProfiles.stripeCustomerId })
    .from(userProfiles)
    .where(eq(userProfiles.id, userId))
    .limit(1);

  return profile?.stripeCustomerId ?? null;
}

export async function createCheckoutSession(
  userId: string,
  email: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  const { db } = await import("../../db/client.ts");
  const { userProfiles } = await import("../../db/schema.ts");
  const { eq } = await import("drizzle-orm");

  let stripeCustomerId = await getStripeCustomerIdForUser(userId);
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { userId },
    });
    stripeCustomerId = customer.id;
    await db
      .update(userProfiles)
      .set({ stripeCustomerId: customer.id })
      .where(eq(userProfiles.id, userId));
  }

  const priceId = Deno.env.get("STRIPE_PLUS_PRICE_ID");
  if (!priceId) {
    throw new Error("STRIPE_PLUS_PRICE_ID is required");
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session.url!;
}

export async function handleSubscriptionWebhook(
  event: Stripe.Event,
): Promise<void> {
  const { db } = await import("../../db/client.ts");
  const { userProfiles } = await import("../../db/schema.ts");
  const { eq } = await import("drizzle-orm");

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const active = sub.status === "active" || sub.status === "trialing";
      await db
        .update(userProfiles)
        .set({
          stripeSubscriptionId: sub.id,
          tier: active ? "plus" : "free",
        })
        .where(eq(userProfiles.stripeCustomerId, sub.customer as string));
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await db
        .update(userProfiles)
        .set({ stripeSubscriptionId: null, tier: "free" })
        .where(eq(userProfiles.stripeCustomerId, sub.customer as string));
      break;
    }
  }
}

export async function createPortalSession(
  stripeCustomerId: string,
  returnUrl: string,
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
  return session.url;
}
