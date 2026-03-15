import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";
import { eq } from "drizzle-orm";

// --- Status → customer-facing email config ---

interface EmailTemplate {
  subject: string;
  body: (ctx: NotificationContext) => string;
}

interface NotificationContext {
  customerName: string;
  orderId: number;
  estimateTotal?: string; // formatted dollar amount
  quoteTotal?: string;
  portalUrl: string;
  reviewUrl?: string; // one-click estimate review link
}

/** Base portal URL — works for both hmls.autos and fixo.hmls.autos */
const PORTAL_URL = Deno.env.get("PORTAL_URL") || "https://hmls.autos/portal";

const STATUS_EMAILS: Record<string, EmailTemplate> = {
  sent: {
    subject: "Your HMLS Estimate is Ready",
    body: (ctx) =>
      `Hi ${ctx.customerName},\n\nYour estimate${
        ctx.estimateTotal ? ` (~${ctx.estimateTotal})` : ""
      } is ready for review.\n\nView details and approve or decline with one tap:\n${
        ctx.reviewUrl ?? `${ctx.portalUrl}/orders`
      }\n\nThanks,\nHMLS Team`,
  },
  approved: {
    subject: "Estimate Approved — We'll Prepare Your Invoice",
    body: (ctx) =>
      `Hi ${ctx.customerName},\n\nThanks for approving your estimate! We're now preparing your invoice with the final pricing.\n\nWe'll notify you as soon as it's ready.\n\nThanks,\nHMLS Team`,
  },
  declined: {
    subject: "Estimate Declined",
    body: (ctx) =>
      `Hi ${ctx.customerName},\n\nWe received your decision to decline the estimate for order #${ctx.orderId}. If you change your mind or have questions, feel free to reach out.\n\nThanks,\nHMLS Team`,
  },
  revised: {
    subject: "Your Revised HMLS Estimate is Ready",
    body: (ctx) =>
      `Hi ${ctx.customerName},\n\nA revised estimate${
        ctx.estimateTotal ? ` (~${ctx.estimateTotal})` : ""
      } is available for your review.\n\nView the updated details:\n${
        ctx.reviewUrl ?? `${ctx.portalUrl}/orders`
      }\n\nThanks,\nHMLS Team`,
  },
  invoiced: {
    subject: "Your HMLS Invoice is Ready",
    body: (ctx) =>
      `Hi ${ctx.customerName},\n\nYour invoice${
        ctx.quoteTotal ? ` ($${ctx.quoteTotal})` : ""
      } is ready. You can review and pay directly through the secure payment link in your portal.\n\n${ctx.portalUrl}/orders\n\nThanks,\nHMLS Team`,
  },
  paid: {
    subject: "Payment Received — Let's Schedule Your Service",
    body: (ctx) =>
      `Hi ${ctx.customerName},\n\nPayment received! The next step is scheduling your service appointment.\n\nVisit your portal to pick a time:\n${ctx.portalUrl}/orders\n\nThanks,\nHMLS Team`,
  },
  scheduled: {
    subject: "Your HMLS Service is Scheduled",
    body: (ctx) =>
      `Hi ${ctx.customerName},\n\nYour service appointment is confirmed. You can view the details in your portal:\n${ctx.portalUrl}/orders\n\nWe'll see you soon!\n\nThanks,\nHMLS Team`,
  },
  in_progress: {
    subject: "Your Service is In Progress",
    body: (ctx) =>
      `Hi ${ctx.customerName},\n\nOur technician has started working on your vehicle. We'll update you when the work is complete.\n\nThanks,\nHMLS Team`,
  },
  completed: {
    subject: "Your HMLS Service is Complete",
    body: (ctx) =>
      `Hi ${ctx.customerName},\n\nGood news — your service is complete! You can view the details and receipt in your portal:\n${ctx.portalUrl}/orders\n\nThank you for choosing HMLS!\n\nThanks,\nHMLS Team`,
  },
  cancelled: {
    subject: "Your HMLS Order Has Been Cancelled",
    body: (ctx) =>
      `Hi ${ctx.customerName},\n\nYour order #${ctx.orderId} has been cancelled. If you have questions, please reach out to us.\n\nThanks,\nHMLS Team`,
  },
};

// --- Admin notification statuses (notify admin, not customer) ---

const ADMIN_NOTIFY_STATUSES = new Set([
  "approved", // customer approved estimate → admin should create invoice
  "declined", // customer declined → admin should know
  "revised", // revised estimate sent → admin awareness
]);

// --- Email sending via Resend ---

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.log(`[notify] RESEND_API_KEY not set — skipping email to ${to}: ${subject}`);
    return false;
  }

  const from = Deno.env.get("NOTIFY_FROM_EMAIL") || "HMLS <noreply@hmls.autos>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[notify] Resend error (${res.status}): ${err}`);
      return false;
    }

    console.log(`[notify] Email sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[notify] Failed to send email:`, err);
    return false;
  }
}

// --- Main notification function ---

export async function notifyOrderStatusChange(
  orderId: number,
  newStatus: string,
): Promise<void> {
  try {
    // Look up order + customer
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (!order) {
      console.warn(`[notify] Order ${orderId} not found`);
      return;
    }

    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, order.customerId))
      .limit(1);

    if (!customer?.email) {
      console.warn(`[notify] No email for customer ${order.customerId}`);
      return;
    }

    const ctx: NotificationContext = {
      customerName: customer.name || "there",
      orderId: order.id,
      portalUrl: PORTAL_URL,
    };

    // Use order's own pricing data (no separate estimates/quotes lookup)
    if (order.priceRangeLowCents && order.priceRangeHighCents) {
      ctx.estimateTotal = `$${(order.priceRangeLowCents / 100).toFixed(0)}–$${
        (order.priceRangeHighCents / 100).toFixed(0)
      }`;
    } else if (order.subtotalCents) {
      ctx.estimateTotal = `$${(order.subtotalCents / 100).toFixed(2)}`;
    }

    if (order.subtotalCents) {
      ctx.quoteTotal = (order.subtotalCents / 100).toFixed(2);
    }

    if (order.shareToken) {
      ctx.reviewUrl = `${PORTAL_URL}/estimate/${order.id}?token=${order.shareToken}`;
    }

    // Send customer email
    const template = STATUS_EMAILS[newStatus];
    if (template) {
      await sendEmail(customer.email, template.subject, template.body(ctx));
    }

    // Notify admin for certain statuses
    if (ADMIN_NOTIFY_STATUSES.has(newStatus)) {
      const adminEmail = Deno.env.get("ADMIN_NOTIFY_EMAIL");
      if (adminEmail) {
        const adminSubject = `[HMLS Admin] Order #${order.id} → ${newStatus}`;
        const adminBody = `Order #${order.id} (${
          customer.name || customer.email
        }) changed to: ${newStatus}\n\nAction may be required.\n\nAdmin portal: ${PORTAL_URL}/admin/orders`;
        await sendEmail(adminEmail, adminSubject, adminBody);
      }
    }
  } catch (err) {
    // Never let notification failures break the main flow
    console.error(`[notify] Error sending notification for order ${orderId}:`, err);
  }
}
