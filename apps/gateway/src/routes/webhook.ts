import { Hono } from "hono";
import Stripe from "stripe";
import { db, schema } from "@hmls/agent/db";
import { and, eq } from "drizzle-orm";
import { notifyOrderStatusChange } from "@hmls/agent";

export function createWebhookRoute(stripeSecretKey: string) {
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2026-01-28.clover",
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

    console.log(`[webhook] Received event: ${event.type} (${event.id})`);

    try {
      switch (event.type) {
        case "quote.accepted":
          await handleQuoteAccepted(event.data.object as Stripe.Quote);
          break;

        case "invoice.paid":
          await handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;

        case "invoice.payment_failed":
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        default:
          console.log(`[webhook] Unhandled event type: ${event.type}`);
      }
    } catch (err) {
      console.error(`[webhook] Error handling ${event.type}:`, err);
    }

    return c.json({ received: true });
  });

  async function handleQuoteAccepted(stripeQuote: Stripe.Quote) {
    const stripeQuoteId = stripeQuote.id;
    console.log(`[webhook] Quote accepted: ${stripeQuoteId}`);

    // Find order by stripe_quote_id (new flow)
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.stripeQuoteId, stripeQuoteId))
      .limit(1);

    if (order) {
      if (order.status !== "invoiced") {
        console.warn(`[webhook] Order ${order.id} is '${order.status}', expected 'invoiced'`);
        return;
      }

      const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
      const [updated] = await db
        .update(schema.orders)
        .set({
          status: "paid",
          statusHistory: [
            ...history,
            { status: "paid", timestamp: new Date().toISOString(), actor: "stripe_webhook" },
          ],
          updatedAt: new Date(),
        })
        .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, "invoiced")))
        .returning();

      if (updated) {
        await logWebhookEvent(order.id, "invoiced", "paid", stripeQuoteId);
        notifyOrderStatusChange(order.id, "paid");
        console.log(`[webhook] Order ${order.id} → paid`);
      }
      return;
    }

    // Legacy: find via quotes table
    const [quote] = await db
      .select()
      .from(schema.quotes)
      .where(eq(schema.quotes.stripeQuoteId, stripeQuoteId))
      .limit(1);

    if (!quote) {
      console.warn(`[webhook] No order or quote found for Stripe quote ${stripeQuoteId}`);
      return;
    }

    await db
      .update(schema.quotes)
      .set({ status: "accepted" })
      .where(eq(schema.quotes.id, quote.id));

    const [legacyOrder] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.quoteId, quote.id))
      .limit(1);

    if (legacyOrder) {
      const history = Array.isArray(legacyOrder.statusHistory) ? legacyOrder.statusHistory : [];
      const [updated] = await db
        .update(schema.orders)
        .set({
          status: "paid",
          statusHistory: [
            ...history,
            { status: "paid", timestamp: new Date().toISOString(), actor: "stripe_webhook" },
          ],
          updatedAt: new Date(),
        })
        .where(and(eq(schema.orders.id, legacyOrder.id), eq(schema.orders.status, "invoiced")))
        .returning();

      if (updated) {
        notifyOrderStatusChange(legacyOrder.id, "paid");
      }
    }
  }

  async function handleInvoicePaid(invoice: Stripe.Invoice) {
    console.log(`[webhook] Invoice paid: ${invoice.id}`);

    // Try to find order by stripe_invoice_id (new flow)
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.stripeInvoiceId, invoice.id))
      .limit(1);

    if (order) {
      if (order.status === "invoiced") {
        const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
        const [updated] = await db
          .update(schema.orders)
          .set({
            status: "paid",
            statusHistory: [
              ...history,
              { status: "paid", timestamp: new Date().toISOString(), actor: "stripe_webhook" },
            ],
            updatedAt: new Date(),
          })
          .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, "invoiced")))
          .returning();

        if (updated) {
          await logWebhookEvent(order.id, "invoiced", "paid", invoice.id);
          notifyOrderStatusChange(order.id, "paid");
          console.log(`[webhook] Order ${order.id} → paid (invoice: ${invoice.id})`);
        }
      }
      return;
    }

    // Legacy: link via quote
    const quoteId = (invoice as unknown as Record<string, unknown>).quote as string | null;
    if (!quoteId) return;

    const [quote] = await db
      .select()
      .from(schema.quotes)
      .where(eq(schema.quotes.stripeQuoteId, quoteId))
      .limit(1);

    if (!quote) return;

    await db
      .update(schema.quotes)
      .set({ stripeInvoiceId: invoice.id, status: "paid" })
      .where(eq(schema.quotes.id, quote.id));

    console.log(`[webhook] Quote ${quote.id} marked as paid (invoice: ${invoice.id})`);
  }

  async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    console.log(`[webhook] Invoice payment failed: ${invoice.id}`);

    // Try order by stripe_invoice_id (new flow)
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.stripeInvoiceId, invoice.id))
      .limit(1);

    if (order && order.status === "invoiced") {
      await db
        .update(schema.orders)
        .set({
          adminNotes: `${
            order.adminNotes ? order.adminNotes + "\n" : ""
          }Payment failed for invoice ${invoice.id}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, order.id));

      await logWebhookEvent(order.id, "invoiced", "payment_failed", invoice.id);
      console.log(`[webhook] Order ${order.id}: payment failed for invoice ${invoice.id}`);
      return;
    }

    // Legacy
    const quoteId = (invoice as unknown as Record<string, unknown>).quote as string | null;
    if (!quoteId) return;

    const [quote] = await db
      .select()
      .from(schema.quotes)
      .where(eq(schema.quotes.stripeQuoteId, quoteId))
      .limit(1);

    if (!quote) return;

    const [legacyOrder] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.quoteId, quote.id))
      .limit(1);

    if (legacyOrder) {
      await db
        .update(schema.orders)
        .set({
          adminNotes: `${
            legacyOrder.adminNotes ? legacyOrder.adminNotes + "\n" : ""
          }Payment failed for invoice ${invoice.id}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, legacyOrder.id));
    }
  }

  async function logWebhookEvent(
    orderId: number,
    fromStatus: string,
    toStatus: string,
    stripeId: string,
  ) {
    await db.insert(schema.orderEvents).values({
      orderId,
      eventType: "status_change",
      fromStatus,
      toStatus,
      actor: "stripe_webhook",
      metadata: { stripeId },
    });
  }

  return webhook;
}
