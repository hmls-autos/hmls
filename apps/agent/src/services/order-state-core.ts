// Pure core of the order state harness: types, state-machine tables,
// read helpers, actor resolution. Zero runtime dependencies — safe to
// import from any layer (web UI, auth middleware, gateway routes, agent
// tools, tests).
//
// DB-touching writes (transition, patchItems, ...) live in order-state.ts
// and build on this module.

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Nine lifecycle states. Payment is a property (paid_at), not a state. */
export type OrderStatus =
  | "draft"
  | "estimated"
  | "revised"
  | "approved"
  | "declined"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

export type TerminalStatus = Extract<OrderStatus, "completed" | "cancelled">;

/** Who is causing the change. Tagged so the harness can permission-check
 *  and stamp a meaningful actor string on the audit event. Callers build
 *  this at the edge from their auth context. Never hardcode "agent".
 *
 *  `share_token` is the authority conferred by possession of the order's
 *  shareToken — used on the public /estimates/:id/approve|decline flow
 *  where the caller is not logged in but is demonstrably the recipient of
 *  the estimate link (often an anonymous / guest customer). */
export type Actor =
  | { kind: "customer"; customerId: number }
  | { kind: "admin"; email: string }
  | { kind: "mechanic"; providerId: number }
  | { kind: "agent"; surface: "customer_chat" | "staff_chat"; actingAs: Actor }
  | {
    kind: "system";
    source: "stripe_webhook" | "cron" | "migration" | "auto_dispatch";
  }
  | { kind: "share_token"; orderId: number };

export type ActorKind = Actor["kind"];

// ---------------------------------------------------------------------------
// State machine tables — single source of truth
// ---------------------------------------------------------------------------

export const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // `draft → scheduled` is the chat-flow shortcut: the customer accumulates
  // items + appointment + auto-assigned mechanic on a draft order, then
  // admin's single "Confirm booking" click promotes the package straight to
  // scheduled. The legacy `draft → estimated → approved → scheduled` path
  // remains for portal/PDF approvals where the customer is not in a chat.
  draft: ["estimated", "scheduled", "cancelled"],
  estimated: ["approved", "declined", "cancelled"],
  declined: ["revised"],
  revised: ["estimated", "cancelled"],
  approved: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** Per-actor transition allowlist. Missing (actor, from) or (actor, from, to)
 *  triples are rejected as FORBIDDEN even when the transition is valid in
 *  TRANSITIONS. `agent` has no entry of its own — authority resolves via
 *  `actingAs`. */
export const ACTOR_PERMISSIONS: Readonly<
  Record<
    Exclude<ActorKind, "agent">,
    Partial<Record<OrderStatus, readonly OrderStatus[]>>
  >
> = {
  customer: {
    // `draft` cancel: chat-flow draft accumulates items + appointment for
    // the customer; they can walk away before admin confirms.
    draft: ["cancelled"],
    estimated: ["approved", "declined", "cancelled"],
    scheduled: ["cancelled"],
  },
  admin: {
    draft: ["estimated", "scheduled", "cancelled"],
    estimated: ["approved", "declined", "cancelled"],
    declined: ["revised"],
    revised: ["estimated", "cancelled"],
    approved: ["scheduled", "cancelled"],
    scheduled: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
  },
  mechanic: {
    scheduled: ["in_progress"],
    in_progress: ["completed"],
  },
  // System actors do not drive transitions today. Payment recording and
  // backfills are non-transition writes. Kept as an explicit empty map so
  // adding a system-driven transition later is a one-line change.
  system: {},
  // Share-token holders can respond to the estimate they were sent.
  // Narrower than customer — no scheduled-order cancel, since cancelling a
  // scheduled appointment needs real auth.
  share_token: {
    estimated: ["approved", "declined"],
  },
};

export const EDITABLE_STATUSES: ReadonlySet<OrderStatus> = new Set(
  ["draft", "revised", "estimated"],
);

/** Statuses on which a payment row can be stamped. Approved is included so
 *  shops that charge a deposit on approval work; draft / estimated /
 *  revised / declined / cancelled reject recordPayment. */
export const PAYMENT_ALLOWED_STATUSES: ReadonlySet<OrderStatus> = new Set(
  ["approved", "scheduled", "in_progress", "completed"],
);

// ---------------------------------------------------------------------------
// Drift self-check (exercised by the L1 test suite)
// ---------------------------------------------------------------------------

/** Every (from, to) in TRANSITIONS must have at least one actor permitted
 *  in ACTOR_PERMISSIONS. A "ghost edge" (legal in the state machine but no
 *  actor can drive it) signals the two tables have drifted. */
export function _checkTransitionActorCoverage(): {
  orphans: Array<{ from: OrderStatus; to: OrderStatus }>;
} {
  const orphans: Array<{ from: OrderStatus; to: OrderStatus }> = [];
  for (const [fromKey, targets] of Object.entries(TRANSITIONS)) {
    const from = fromKey as OrderStatus;
    for (const to of targets) {
      const hasAny = Object.values(ACTOR_PERMISSIONS).some(
        (perms) => perms[from]?.includes(to) ?? false,
      );
      if (!hasAny) orphans.push({ from, to });
    }
  }
  return { orphans };
}

// ---------------------------------------------------------------------------
// Internal helpers (exported for the write layer, not meant for UI / auth)
// ---------------------------------------------------------------------------

/** Walk an `agent` chain down to the underlying non-agent actor. Throws on
 *  pathological chains (types prevent this normally; guard catches unsafe
 *  casts). */
export function resolveAuthority(actor: Actor): Exclude<Actor, { kind: "agent" }> {
  let current: Actor = actor;
  let hops = 0;
  while (current.kind === "agent") {
    if (hops++ > 4) {
      throw new Error("Actor delegation chain too deep");
    }
    current = current.actingAs;
  }
  return current;
}

/** Short, stable actor string for order_events.actor. Examples:
 *  "customer:42", "admin:alice@shop.com", "mechanic:7",
 *  "agent(customer_chat)->customer:42", "system:stripe_webhook". */
export function actorString(actor: Actor): string {
  switch (actor.kind) {
    case "customer":
      return `customer:${actor.customerId}`;
    case "admin":
      return `admin:${actor.email}`;
    case "mechanic":
      return `mechanic:${actor.providerId}`;
    case "system":
      return `system:${actor.source}`;
    case "share_token":
      return `share_token:order${actor.orderId}`;
    case "agent":
      return `agent(${actor.surface})->${actorString(actor.actingAs)}`;
    default: {
      const _exhaustive: never = actor;
      throw new Error(`Unknown actor kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function isOrderStatus(s: string): s is OrderStatus {
  return s in TRANSITIONS;
}

// ---------------------------------------------------------------------------
// Read helpers — safe to import from any layer (UI, auth, middleware)
// ---------------------------------------------------------------------------

export function isTerminal(status: OrderStatus): status is TerminalStatus {
  return status === "completed" || status === "cancelled";
}

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canActorTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: Actor,
): boolean {
  if (!allowedTransitions(from).includes(to)) return false;
  const authority = resolveAuthority(actor);
  const perms = ACTOR_PERMISSIONS[authority.kind];
  return perms[from]?.includes(to) ?? false;
}

/** UI helper — the subset of allowed transitions this actor may currently
 *  drive. Used by admin dashboard + customer portal to render action
 *  buttons without hardcoding rules client-side. */
export function availableActions(
  from: OrderStatus,
  actor: Actor,
): readonly OrderStatus[] {
  const authority = resolveAuthority(actor);
  const perms = ACTOR_PERMISSIONS[authority.kind][from] ?? [];
  const allowed = allowedTransitions(from);
  return perms.filter((s) => allowed.includes(s));
}
