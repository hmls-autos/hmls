// L1 pure tests for the order-state harness.
//
// Covers the read helpers, the state-machine table shape, the actor
// permission map, and the resolveAuthority / actorString internals. No DB.
//
// L2 tests (real DB, transaction atomicity, concurrency) live in a
// separate file so this suite stays fast and zero-dependency.

import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import {
  _checkTransitionActorCoverage,
  type Actor,
  ACTOR_PERMISSIONS,
  allowedTransitions,
  availableActions,
  canActorTransition,
  isTerminal,
  type OrderStatus,
  TRANSITIONS,
} from "./order-state-core.ts";

const ALL_STATUSES: readonly OrderStatus[] = [
  "draft",
  "estimated",
  "revised",
  "approved",
  "declined",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];

const CUSTOMER: Actor = { kind: "customer", customerId: 42 };
const ADMIN: Actor = { kind: "admin", email: "alice@shop.com" };
const MECHANIC: Actor = { kind: "mechanic", providerId: 7 };
const SYSTEM: Actor = { kind: "system", source: "stripe_webhook" };
const SHARE_TOKEN: Actor = { kind: "share_token", orderId: 99 };

// ---------------------------------------------------------------------------
// Consistency: TRANSITIONS and ACTOR_PERMISSIONS must not drift
// ---------------------------------------------------------------------------

Deno.test("consistency: every TRANSITIONS edge has at least one actor permitted", () => {
  const { orphans } = _checkTransitionActorCoverage();
  assertEquals(
    orphans,
    [],
    `Ghost edges detected (transitions with no actor): ${JSON.stringify(orphans)}`,
  );
});

Deno.test("consistency: ACTOR_PERMISSIONS never permits an edge outside TRANSITIONS", () => {
  const violations: Array<{ actor: string; from: string; to: string }> = [];
  for (const [actorKind, perms] of Object.entries(ACTOR_PERMISSIONS)) {
    for (const [fromKey, targets] of Object.entries(perms)) {
      const from = fromKey as OrderStatus;
      const allowed = TRANSITIONS[from] ?? [];
      for (const to of targets ?? []) {
        if (!allowed.includes(to)) {
          violations.push({ actor: actorKind, from, to });
        }
      }
    }
  }
  assertEquals(
    violations,
    [],
    `Actor permissions reference non-existent transitions: ${JSON.stringify(violations)}`,
  );
});

Deno.test("consistency: every OrderStatus has an entry in TRANSITIONS", () => {
  for (const s of ALL_STATUSES) {
    // Accessing .length also asserts the value is an array, not undefined.
    assertEquals(typeof TRANSITIONS[s].length, "number", `missing TRANSITIONS[${s}]`);
  }
});

// ---------------------------------------------------------------------------
// isTerminal
// ---------------------------------------------------------------------------

Deno.test("isTerminal: completed + cancelled are terminal, others are not", () => {
  for (const s of ALL_STATUSES) {
    const expected = s === "completed" || s === "cancelled";
    assertEquals(isTerminal(s), expected, `isTerminal(${s})`);
  }
});

Deno.test("isTerminal: terminal statuses have no outbound transitions", () => {
  for (const s of ALL_STATUSES) {
    if (isTerminal(s)) {
      assertEquals(TRANSITIONS[s], [], `terminal ${s} should have empty transitions`);
    }
  }
});

// ---------------------------------------------------------------------------
// allowedTransitions — shape of the state machine
// ---------------------------------------------------------------------------

Deno.test("allowedTransitions: draft goes to estimated, scheduled or cancelled", () => {
  assertEquals(
    [...allowedTransitions("draft")].sort(),
    ["cancelled", "estimated", "scheduled"],
  );
});

Deno.test("allowedTransitions: estimated goes to approved/declined/cancelled", () => {
  assertEquals(
    [...allowedTransitions("estimated")].sort(),
    ["approved", "cancelled", "declined"],
  );
});

Deno.test("allowedTransitions: declined only re-enters via revised", () => {
  assertEquals([...allowedTransitions("declined")], ["revised"]);
});

Deno.test("allowedTransitions: approved advances to scheduled or cancels", () => {
  assertEquals([...allowedTransitions("approved")].sort(), ["cancelled", "scheduled"]);
});

Deno.test("allowedTransitions: scheduled -> in_progress or cancelled", () => {
  assertEquals(
    [...allowedTransitions("scheduled")].sort(),
    ["cancelled", "in_progress"],
  );
});

Deno.test("allowedTransitions: in_progress -> completed or cancelled", () => {
  assertEquals(
    [...allowedTransitions("in_progress")].sort(),
    ["cancelled", "completed"],
  );
});

// ---------------------------------------------------------------------------
// canActorTransition — representative cases across actor kinds
// ---------------------------------------------------------------------------

Deno.test("canActorTransition: customer can approve estimated", () => {
  assertStrictEquals(canActorTransition("estimated", "approved", CUSTOMER), true);
});

Deno.test("canActorTransition: customer can decline estimated", () => {
  assertStrictEquals(canActorTransition("estimated", "declined", CUSTOMER), true);
});

Deno.test("canActorTransition: customer can cancel scheduled", () => {
  assertStrictEquals(canActorTransition("scheduled", "cancelled", CUSTOMER), true);
});

Deno.test("canActorTransition: customer CANNOT send draft -> estimated (shop-only)", () => {
  assertStrictEquals(canActorTransition("draft", "estimated", CUSTOMER), false);
});

Deno.test("canActorTransition: customer CANNOT advance scheduled -> in_progress", () => {
  assertStrictEquals(canActorTransition("scheduled", "in_progress", CUSTOMER), false);
});

Deno.test("canActorTransition: customer CANNOT cancel in_progress (must contact shop)", () => {
  assertStrictEquals(canActorTransition("in_progress", "cancelled", CUSTOMER), false);
});

Deno.test("canActorTransition: admin can send draft -> estimated", () => {
  assertStrictEquals(canActorTransition("draft", "estimated", ADMIN), true);
});

Deno.test("canActorTransition: admin can revise declined -> revised", () => {
  assertStrictEquals(canActorTransition("declined", "revised", ADMIN), true);
});

Deno.test("canActorTransition: admin can cancel from any active state", () => {
  const active: OrderStatus[] = [
    "draft",
    "estimated",
    "revised",
    "approved",
    "scheduled",
    "in_progress",
  ];
  for (const from of active) {
    assertStrictEquals(
      canActorTransition(from, "cancelled", ADMIN),
      true,
      `admin should cancel from ${from}`,
    );
  }
});

Deno.test("canActorTransition: mechanic can start scheduled work", () => {
  assertStrictEquals(canActorTransition("scheduled", "in_progress", MECHANIC), true);
});

Deno.test("canActorTransition: mechanic can complete in_progress work", () => {
  assertStrictEquals(canActorTransition("in_progress", "completed", MECHANIC), true);
});

Deno.test("canActorTransition: mechanic CANNOT approve estimated (not their role)", () => {
  assertStrictEquals(canActorTransition("estimated", "approved", MECHANIC), false);
});

Deno.test("canActorTransition: mechanic CANNOT cancel (escalate to admin)", () => {
  assertStrictEquals(canActorTransition("scheduled", "cancelled", MECHANIC), false);
});

Deno.test("canActorTransition: system drives no transitions by default", () => {
  for (const from of ALL_STATUSES) {
    for (const to of allowedTransitions(from)) {
      assertStrictEquals(
        canActorTransition(from, to, SYSTEM),
        false,
        `system should not drive ${from}->${to}`,
      );
    }
  }
});

Deno.test("canActorTransition: share_token approves estimated", () => {
  assertStrictEquals(canActorTransition("estimated", "approved", SHARE_TOKEN), true);
});

Deno.test("canActorTransition: share_token declines estimated", () => {
  assertStrictEquals(canActorTransition("estimated", "declined", SHARE_TOKEN), true);
});

Deno.test("canActorTransition: share_token CANNOT cancel scheduled (needs real auth)", () => {
  assertStrictEquals(canActorTransition("scheduled", "cancelled", SHARE_TOKEN), false);
});

Deno.test("canActorTransition: share_token CANNOT cancel estimated (only approve/decline)", () => {
  assertStrictEquals(canActorTransition("estimated", "cancelled", SHARE_TOKEN), false);
});

Deno.test("canActorTransition: terminal states reject every transition", () => {
  for (const actor of [CUSTOMER, ADMIN, MECHANIC, SYSTEM, SHARE_TOKEN]) {
    for (const from of ["completed", "cancelled"] as const) {
      for (const to of ALL_STATUSES) {
        assertStrictEquals(
          canActorTransition(from, to, actor),
          false,
          `${from}->${to} should be forbidden for all actors`,
        );
      }
    }
  }
});

Deno.test("canActorTransition: invalid transitions rejected even when actor is admin", () => {
  // draft -> approved is not in TRANSITIONS; admin cannot force it.
  assertStrictEquals(canActorTransition("draft", "approved", ADMIN), false);
  // completed -> anything
  assertStrictEquals(canActorTransition("completed", "cancelled", ADMIN), false);
});

// ---------------------------------------------------------------------------
// availableActions — UI helper
// ---------------------------------------------------------------------------

Deno.test("availableActions: customer on estimated sees approve/decline/cancel", () => {
  assertEquals(
    [...availableActions("estimated", CUSTOMER)].sort(),
    ["approved", "cancelled", "declined"],
  );
});

Deno.test("availableActions: customer on draft can only cancel", () => {
  // Chat-flow draft: customer accumulates items + appointment; if they
  // walk away mid-chat they can cancel. Shop owns the draft → scheduled
  // confirm transition.
  assertEquals(availableActions("draft", CUSTOMER), ["cancelled"]);
});

Deno.test("availableActions: admin on approved sees scheduled + cancelled", () => {
  assertEquals(
    [...availableActions("approved", ADMIN)].sort(),
    ["cancelled", "scheduled"],
  );
});

Deno.test("availableActions: mechanic on scheduled sees only in_progress", () => {
  assertEquals([...availableActions("scheduled", MECHANIC)], ["in_progress"]);
});

Deno.test("availableActions: terminal states return empty regardless of actor", () => {
  for (const actor of [CUSTOMER, ADMIN, MECHANIC, SYSTEM, SHARE_TOKEN]) {
    assertEquals(availableActions("completed", actor), []);
    assertEquals(availableActions("cancelled", actor), []);
  }
});

// ---------------------------------------------------------------------------
// Agent delegation (resolveAuthority via canActorTransition surface)
// ---------------------------------------------------------------------------

Deno.test("agent inherits customer authority via actingAs", () => {
  const agent: Actor = {
    kind: "agent",
    surface: "customer_chat",
    actingAs: CUSTOMER,
  };
  assertStrictEquals(canActorTransition("estimated", "approved", agent), true);
  assertStrictEquals(canActorTransition("draft", "estimated", agent), false);
});

Deno.test("agent inherits admin authority via actingAs", () => {
  const agent: Actor = {
    kind: "agent",
    surface: "staff_chat",
    actingAs: ADMIN,
  };
  assertStrictEquals(canActorTransition("draft", "estimated", agent), true);
  assertStrictEquals(canActorTransition("declined", "revised", agent), true);
});

Deno.test("agent authority does not escalate past its actingAs", () => {
  // A customer-acting agent cannot suddenly drive a mechanic-only edge.
  const customerAgent: Actor = {
    kind: "agent",
    surface: "customer_chat",
    actingAs: CUSTOMER,
  };
  assertStrictEquals(
    canActorTransition("scheduled", "in_progress", customerAgent),
    false,
  );
});

Deno.test("nested agent chains resolve correctly", () => {
  // Legal but weird: an agent delegating to another agent.
  const inner: Actor = {
    kind: "agent",
    surface: "customer_chat",
    actingAs: ADMIN,
  };
  const outer: Actor = {
    kind: "agent",
    surface: "staff_chat",
    actingAs: inner,
  };
  assertStrictEquals(canActorTransition("draft", "estimated", outer), true);
});

Deno.test("agent delegation depth guard throws on pathological chains", () => {
  // Build a chain 6 deep — past the depth guard of 4 hops.
  let chain: Actor = ADMIN;
  for (let i = 0; i < 6; i++) {
    chain = { kind: "agent", surface: "staff_chat", actingAs: chain };
  }
  assertThrows(
    () => canActorTransition("draft", "estimated", chain),
    Error,
    "Actor delegation chain too deep",
  );
});

// ---------------------------------------------------------------------------
// Smoke: full matrix sanity — no permission can violate TRANSITIONS
// ---------------------------------------------------------------------------

Deno.test("smoke: canActorTransition implies allowedTransitions for every matrix cell", () => {
  const actors: Actor[] = [CUSTOMER, ADMIN, MECHANIC, SYSTEM, SHARE_TOKEN];
  for (const actor of actors) {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (canActorTransition(from, to, actor)) {
          const allowed = TRANSITIONS[from];
          assertEquals(
            allowed.includes(to),
            true,
            `${actor.kind} can ${from}->${to} but TRANSITIONS does not list it`,
          );
        }
      }
    }
  }
});
