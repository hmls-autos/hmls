// Display layer for order status. Tailwind class names + human-readable
// labels live here, web-only. State-machine constants (TRANSITIONS,
// EDITABLE_STATUSES, ORDER_MAIN_STEPS, getOrderStepState, ...) come from
// `@hmls/shared/order/status` and must NOT be redefined here.

import {
  canonicalizeStatus,
  hasBeenSentToCustomer,
  isOrderStatus,
  type OrderStatus,
} from "@hmls/shared/order/status";

export interface StatusConfig {
  label: string;
  color: string;
}

/** Canonicalize a raw status string (DB rows may still carry the legacy
 *  'scheduled' / 'revised' labels during the 9→7 deploy→remap window).
 *  Returns null instead of throwing on garbage so display code can fall
 *  back gracefully. This is the web's single entry to the shared
 *  alias-tolerance point — do not add ad-hoc `=== "scheduled"` branches. */
export function canonicalStatus(raw: string): OrderStatus | null {
  try {
    return canonicalizeStatus(raw);
  } catch {
    return null;
  }
}

// Black / white / red only — a hue would clash with the red brand accent (esp.
// green). States are grouped by "what does this order need from me", encoded by
// treatment, not colour:
//   RED_PILL   → needs the shop to act (declined; "pending" sub-badges below)
//   DARK_PILL  → committed / in motion (approved, in progress, scheduled) — a
//                solid inverted pill that pops out of the neutral ones
//   NEUTRAL    → passive: waiting on the customer, or already settled
const NEUTRAL_PILL =
  "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";
const DARK_PILL = "bg-foreground text-background";
const RED_PILL = "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300";

export const ORDER_STATUS: Record<OrderStatus, StatusConfig> = {
  draft: { label: "Draft", color: NEUTRAL_PILL },
  estimated: { label: "Estimated", color: NEUTRAL_PILL },
  approved: { label: "Approved", color: DARK_PILL },
  declined: { label: "Declined", color: RED_PILL },
  in_progress: { label: "In Progress", color: DARK_PILL },
  completed: { label: "Completed", color: NEUTRAL_PILL },
  cancelled: {
    label: "Cancelled",
    color:
      "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  },
};

/** Portal-facing labels (admin/portal share colors but differ on phrasing). */
export const PORTAL_ORDER_STATUS: Record<OrderStatus, StatusConfig> = {
  ...ORDER_STATUS,
  draft: { ...ORDER_STATUS.draft, label: "Preparing" },
  estimated: { ...ORDER_STATUS.estimated, label: "Estimate Ready" },
};

export const ORDER_STEP_LABELS_ADMIN: Record<OrderStatus, string> = {
  draft: "Draft",
  estimated: "Estimated",
  approved: "Approved",
  in_progress: "In Progress",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const ORDER_STEP_LABELS_PORTAL: Record<OrderStatus, string> = {
  draft: "Preparing",
  estimated: "Estimate Ready",
  approved: "Approved",
  in_progress: "In Progress",
  completed: "Complete",
  declined: "Declined",
  cancelled: "Cancelled",
};

/** History is immutable: statusHistory entries and order_events may carry the
 *  retired 'scheduled' / 'revised' labels forever. Render them with their
 *  historical wording instead of canonicalizing (a "Approved → Approved"
 *  timeline line would be nonsense) and never crash on unknowns. */
const LEGACY_HISTORY_LABELS: Record<
  "admin" | "portal",
  Record<string, string>
> = {
  admin: { scheduled: "Scheduled", revised: "Revised" },
  portal: { scheduled: "Scheduled", revised: "Updated Estimate" },
};

export function historicalStatusLabel(
  raw: string,
  surface: "admin" | "portal" = "admin",
): string {
  if (isOrderStatus(raw)) {
    return surface === "portal"
      ? ORDER_STEP_LABELS_PORTAL[raw]
      : ORDER_STEP_LABELS_ADMIN[raw];
  }
  return LEGACY_HISTORY_LABELS[surface][raw] ?? raw;
}

/** Tentative-booking display for chat-flow drafts that already have a slot
 *  + auto-assigned mechanic but are still waiting on shop review. The
 *  state-machine status is `draft`, but we surface it to the customer as
 *  "Pending Confirmation" so the UX matches what just happened in chat
 *  (without lying that the booking is locked). Admin sees the same
 *  treatment so the review queue is visually distinct from plain drafts. */
const PENDING_CONFIRMATION_CONFIG: StatusConfig = {
  label: "Pending Confirmation",
  // Attention state → red (matches the dashboard's "pending review" accent).
  color: RED_PILL,
};

/** Booked display for approved orders whose slot + mechanic pair is complete.
 *  `scheduled` is no longer a status — approved + scheduledAt + providerId IS
 *  the confirmed booking — but the customer-facing wording keeps saying
 *  "Scheduled" because that's what they care about. */
const SCHEDULED_BOOKING_CONFIG: StatusConfig = {
  label: "Scheduled",
  color: DARK_PILL,
};

/** True when a draft has accumulated chat-flow scheduling — it is
 *  tentatively booked, not just an estimate. */
export function isTentativeBooking(order: {
  status: string;
  scheduledAt?: string | Date | null;
}): boolean {
  return canonicalStatus(order.status) === "draft" && order.scheduledAt != null;
}

/** True when an approved order's booking pair (slot + mechanic) is complete —
 *  the state the retired `scheduled` status used to mark. */
export function isBookedOrder(order: {
  status: string;
  scheduledAt?: string | Date | null;
  providerId?: number | null;
}): boolean {
  return (
    canonicalStatus(order.status) === "approved" &&
    order.scheduledAt != null &&
    order.providerId != null
  );
}

/** Derived sub-badge for the two statuses with dual semantics:
 *  - draft: previously sent → "Revising · rev N"; fresh AI draft → "Pending
 *    review" (predicate = hasBeenSentToCustomer, never revisionNumber).
 *  - approved: slot+mechanic complete → "Scheduled"; otherwise "Pending
 *    schedule".
 *  Returns null for every other status. Admin surfaces render this next to
 *  the main status badge. */
export function orderSubBadge(order: {
  status: string;
  scheduledAt?: string | Date | null;
  providerId?: number | null;
  revisionNumber?: number | null;
  statusHistory?: readonly { status: string }[] | null;
}): StatusConfig | null {
  const status = canonicalStatus(order.status);
  if (status === "draft") {
    return hasBeenSentToCustomer({ statusHistory: order.statusHistory ?? null })
      ? {
          label: `Revising · rev ${order.revisionNumber ?? 1}`,
          // In-progress revision — neutral; the red accent is reserved for
          // things actually waiting on the shop (pending review/schedule).
          color: NEUTRAL_PILL,
        }
      : { label: "Pending review", color: RED_PILL };
  }
  if (status === "approved") {
    return order.scheduledAt != null && order.providerId != null
      ? SCHEDULED_BOOKING_CONFIG
      : { label: "Pending schedule", color: RED_PILL };
  }
  return null;
}

/** Lookup helper that handles legacy + unknown DB status values gracefully.
 *  Use this from JSX instead of indexing the records directly.
 *  Pass `tentativeBooking: true` when the order is a chat-flow draft with a
 *  slot already attached — it returns "Pending Confirmation" instead of the
 *  bare draft/Preparing label. Pass `scheduledBooking: true` (see
 *  isBookedOrder) to surface an approved order with a locked-in slot as
 *  "Scheduled" — customer-facing surfaces use this so the wording survives
 *  the 9→7 status collapse. */
export function statusDisplay(
  status: string,
  surface: "admin" | "portal" = "admin",
  opts?: { tentativeBooking?: boolean; scheduledBooking?: boolean },
): StatusConfig {
  const canonical = canonicalStatus(status);
  if (opts?.tentativeBooking && canonical === "draft") {
    return PENDING_CONFIRMATION_CONFIG;
  }
  if (opts?.scheduledBooking && canonical === "approved") {
    return SCHEDULED_BOOKING_CONFIG;
  }
  const map = surface === "portal" ? PORTAL_ORDER_STATUS : ORDER_STATUS;
  return canonical
    ? map[canonical]
    : {
        label: status,
        color: "bg-neutral-100 text-neutral-500",
      };
}
