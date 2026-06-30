# Multi-tenancy: Area↔Shop Bridge + Coverage Flag + Real Tenant Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three cheap, high-value gaps in the current area/shop/mechanic model — surface
out-of-coverage orders for review, bridge the web `region` layer to the DB `shop` tenant without
merging them, and upgrade the tenant-scoping guard from a per-file substring check to a per-query
proximity scan.

**Architecture:** Three independent, individually-shippable tasks. (1) Persist the already-computed
`autoRouted=false` routing miss into `orders.adminNotes` and seed `shops.service_radius_km` so "out
of coverage" becomes detectable + visible. (2) Add an explicit, tested `shopSlug` field on each web
`Region` (no rename — keeps `REGIONS.oc`/`.sj` dot-access) so region↔shop is a documented,
drift-proof bridge rather than a coincidence. (3) Rewrite `tenant-guard_test.ts` to scan each
tenant-table query for a nearby shop-scope token. RLS (the real isolation backstop) is a **separate
spec** — see "Out of scope / Task 4".

**Tech Stack:** Deno (gateway + agent, `@std` test), Bun (web, `bun:test`), Drizzle ORM, Postgres
(Supabase), raw idempotent SQL migrations applied via `scripts/db-apply.sh`.

## Global Constraints

- **Migrations are applied via `scripts/db-apply.sh <env> <file>`, NEVER `db:migrate`** — the
  drizzle journal tracks only ~2 of ~35 files; the `.sql` files are the source of truth. Every new
  migration MUST be idempotent.
- **`dev` Infisical env IS the prod Supabase DB.** Applying any migration touches production. The
  migration step in Task 1 writes the file but applying it to the DB requires explicit user
  go-ahead.
- **Deno code:** double quotes, 2-space indent, 100-char lines (`deno fmt`). **Web:** Biome, double
  quotes, 2-space indent.
- **The customer-facing service address is required on the customer agent path** (`order.ts`
  `isCustomerSide` check) — so on that path `autoRouted=false` always means "geocode failed" or
  "outside every service radius", never "no address".
- Do not weaken Task 3's guard to make it pass — tune the window/tokens or add an explicit
  `// tenant-ok: <reason>` escape per real false-positive.
- Full local CI must pass before any push:
  `cd apps/hmls-web && bun run lint && bun run typecheck && bun run test && bun run build`;
  `deno task check`; `deno test` for the gateway/agent suites.

---

## File Structure

- `apps/agent/migrations/0036_seed_shop_service_radius.sql` — **create**. Idempotent UPDATE seeding
  `service_radius_km` on the two shops.
- `apps/agent/src/common/shop-routing.ts` — **modify**. Add a pure `routingReviewNote()` helper next
  to `routeOrderToShop`.
- `apps/agent/src/common/shop-routing_test.ts` — **modify**. Add unit tests for
  `routingReviewNote()`.
- `apps/agent/src/common/tools/order.ts` — **modify**. Capture `autoRouted`, build the note via the
  helper, persist it to `orders.adminNotes` on INSERT.
- `apps/hmls-web/lib/business.ts` — **modify**. Add `shopSlug` to the `Region` interface + both
  `REGIONS` entries.
- `apps/hmls-web/lib/business.test.ts` — **create**. Parity test: every region's `shopSlug` is a
  known shop and its geo matches the shop seed coords.
- `apps/gateway/src/tenant-guard_test.ts` — **rewrite**. Per-query proximity scan.

---

### Task 1: Coverage-aware routing — seed radius + persist the routing-miss flag

**Files:**

- Create: `apps/agent/migrations/0036_seed_shop_service_radius.sql`
- Modify: `apps/agent/src/common/shop-routing.ts` (add helper after `routeOrderToShop`, ends
  line 82)
- Test: `apps/agent/src/common/shop-routing_test.ts`
- Modify: `apps/agent/src/common/tools/order.ts:678-689` (routing branch) and the INSERT
  `.values({...})` at `order.ts:787-813`

**Interfaces:**

- Consumes:
  `routeOrderToShop(address): Promise<{ shopId; coords: Coords | null; autoRouted: boolean }>`
  (existing, `shop-routing.ts:64`).
- Produces: `routingReviewNote(r: { autoRouted: boolean; coords: Coords | null }): string | null` —
  exported from `shop-routing.ts`. Returns `null` when `autoRouted` is true (no review needed); a
  human-readable warning string otherwise, distinguishing geocode-fail (`coords === null`) from
  out-of-range (`coords !== null`).

- [ ] **Step 1: Write the failing test for the note helper**

In `apps/agent/src/common/shop-routing_test.ts`, add:

```ts
import { routingReviewNote } from "./shop-routing.ts";

Deno.test("routingReviewNote: null when the order auto-routed", () => {
  assertEquals(routingReviewNote({ autoRouted: true, coords: { lat: 37, lng: -121 } }), null);
});

Deno.test("routingReviewNote: out-of-range note when coords resolved but no shop matched", () => {
  const note = routingReviewNote({ autoRouted: false, coords: { lat: 0, lng: 0 } });
  assertEquals(typeof note, "string");
  assertEquals(note!.includes("service radius"), true);
});

Deno.test("routingReviewNote: geocode-fail note when coords are null", () => {
  const note = routingReviewNote({ autoRouted: false, coords: null });
  assertEquals(typeof note, "string");
  assertEquals(note!.includes("geocode"), true);
});
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `cd apps/agent && deno test src/common/shop-routing_test.ts` Expected: FAIL —
`routingReviewNote` is not exported.

- [ ] **Step 3: Implement the helper**

In `apps/agent/src/common/shop-routing.ts`, after `routeOrderToShop` (after line 82), add:

```ts
/**
 * Review note for an order whose shop was NOT auto-routed. Customer orders
 * always carry a service address, so a non-auto-route means the address
 * either failed to geocode or fell outside every shop's service radius — the
 * order landed on the primary shop as a fallback and a human should confirm
 * the assignment. Returns null when the order auto-routed (nothing to review).
 */
export function routingReviewNote(
  r: { autoRouted: boolean; coords: Coords | null },
): string | null {
  if (r.autoRouted) return null;
  return r.coords
    ? "⚠ Auto-routed to the default shop — the service address is outside every shop's service radius. Verify the assigned shop."
    : "⚠ Auto-routed to the default shop — could not geocode the service address. Verify the assigned shop.";
}
```

- [ ] **Step 4: Run the tests; confirm green**

Run: `cd apps/agent && deno test src/common/shop-routing_test.ts` Expected: PASS (all
`routingReviewNote` + existing cases).

- [ ] **Step 5: Wire the note into create_order**

In `apps/agent/src/common/tools/order.ts`, import the helper (extend the existing `shop-routing.ts`
import that already brings in `routeOrderToShop`, `geocodeAddress`, `Coords`):

```ts
import {
  type Coords,
  geocodeAddress,
  routeOrderToShop,
  routingReviewNote,
} from "../shop-routing.ts";
```

Replace the routing branch (`order.ts:678-689`) with:

```ts
let orderShopId: string;
let coords: Coords | null;
let routingNote: string | null = null;
if (isCustomerAgent) {
  const routed = await routeOrderToShop(orderAddress);
  orderShopId = routed.shopId; // nearest shop wins
  coords = routed.coords;
  // Coverage flag: surface a routing miss for staff review instead of
  // silently leaving the order on the primary-shop fallback. ponytail:
  // adminNotes is the cheapest visible channel (renders in the order
  // detail Notes card); upgrade to a list badge if the queue needs it.
  routingNote = routingReviewNote(routed);
} else {
  orderShopId = insertAccess.shopId as string; // staff's own shop (per canWrite)
  coords = orderAddress ? await geocodeAddress(orderAddress) : null;
}
const locationLat = coords ? String(coords.lat) : null;
const locationLng = coords ? String(coords.lng) : null;
```

Then in the INSERT `.values({...})` (after `notes: params.notes ?? null,`, `order.ts:795`), add:

```ts
adminNotes: routingNote,
```

- [ ] **Step 6: Typecheck + agent tests**

Run: `deno task check && cd apps/agent && deno test src/common/` Expected: PASS.

- [ ] **Step 7: Write the radius migration**

Create `apps/agent/migrations/0036_seed_shop_service_radius.sql`:

```sql
-- 0036: seed per-shop service radius (km) so order routing can flag
-- out-of-coverage service addresses (nearestShop already enforces the cap;
-- the column was created NULL in 0030 and never seeded).
-- TUNABLE KNOB: widen/narrow per metro as real coverage data accrues. 80km is
-- a deliberately loose metro radius (errs toward NOT flagging legit edge
-- customers). Only seeds rows that are still NULL, so re-running is a no-op and
-- a hand-tuned value is never overwritten.
UPDATE shops SET service_radius_km = 80
WHERE slug IN ('san-jose', 'orange-county') AND service_radius_km IS NULL;
```

- [ ] **Step 8: Commit (code + migration file; do NOT apply to DB yet)**

```bash
git add apps/agent/migrations/0036_seed_shop_service_radius.sql \
        apps/agent/src/common/shop-routing.ts \
        apps/agent/src/common/shop-routing_test.ts \
        apps/agent/src/common/tools/order.ts
git commit -m "feat(orders): flag out-of-coverage auto-routed orders for staff review + seed shop service radius"
```

- [ ] **Step 9: Apply the migration — REQUIRES EXPLICIT USER GO-AHEAD**

`dev` Infisical IS prod. Do not run this without the user confirming. When confirmed: Run:
`scripts/db-apply.sh dev apps/agent/migrations/0036_seed_shop_service_radius.sql` Verify:
`SELECT slug, service_radius_km FROM shops;` shows 80 for both.

---

### Task 2: Region↔Shop bridge — explicit `shopSlug` + parity test

**Files:**

- Modify: `apps/hmls-web/lib/business.ts` (`Region` interface ~line 103-126; both `REGIONS` entries
  128-158)
- Test: `apps/hmls-web/lib/business.test.ts` (create)

**Interfaces:**

- Produces: `Region.shopSlug: string` — the DB `shops.slug` this marketing region maps to.
  `REGIONS.oc.shopSlug === "orange-county"`, `REGIONS.sj.shopSlug === "san-jose"`. Consumed by any
  future code that needs to go from a marketing region to its tenant shop (e.g. city-page
  pre-routing — deferred).

- [ ] **Step 1: Write the failing parity test**

Create `apps/hmls-web/lib/business.test.ts`:

```ts
import { expect, test } from "bun:test";
import { REGIONS } from "./business";

// The shop-seed coords live in apps/agent/migrations/0030_multi_tenancy.sql.
// This pins the web region geo to that seed so the two never drift silently.
// Update BOTH together (this map + the migration) on any real move/rebrand.
const SHOP_SEED: Record<string, { lat: number; lng: number }> = {
  "orange-county": { lat: 33.6484505, lng: -117.8365716 },
  "san-jose": { lat: 37.3361663, lng: -121.890591 },
};

test("every region maps to a known shop slug with matching coords", () => {
  for (const region of Object.values(REGIONS)) {
    const seed = SHOP_SEED[region.shopSlug];
    expect(seed, `region ${region.id} -> unknown shopSlug ${region.shopSlug}`).toBeDefined();
    expect(Math.abs(region.geo.latitude - seed.lat)).toBeLessThan(0.01);
    expect(Math.abs(region.geo.longitude - seed.lng)).toBeLessThan(0.01);
  }
});
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `cd apps/hmls-web && bun test lib/business.test.ts` Expected: FAIL — `region.shopSlug` is
`undefined` → `SHOP_SEED[undefined]` undefined.

- [ ] **Step 3: Add `shopSlug` to the interface + both entries**

In `apps/hmls-web/lib/business.ts`, add to the `Region` interface (after `id: RegionId;`, line 104):

```ts
/** The DB shops.slug this marketing region maps to (apps/agent shops table). */
shopSlug: string;
```

In `REGIONS.oc` (after `id: "oc",`, line 130) add:

```ts
shopSlug: "orange-county",
```

In `REGIONS.sj` (after `id: "sj",`, line 141) add:

```ts
shopSlug: "san-jose",
```

- [ ] **Step 4: Run test + typecheck; confirm green**

Run: `cd apps/hmls-web && bun test lib/business.test.ts && bun run typecheck` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hmls-web/lib/business.ts apps/hmls-web/lib/business.test.ts
git commit -m "feat(web): bridge marketing region to DB shop via tested shopSlug field"
```

---

### Task 3: Real tenant guard — per-query proximity scan

**Files:**

- Rewrite: `apps/gateway/src/tenant-guard_test.ts`

**Interfaces:** none exported — this is a CI test only.

- [ ] **Step 1: Rewrite the guard**

Replace the entire contents of `apps/gateway/src/tenant-guard_test.ts` with:

```ts
// Fails if a gateway route file queries a tenant table (orders/customers/
// providers) without a shop-scope token near the query. Stronger than the old
// per-file substring check (which passed on a mere comment mention of
// "shopId"): it inspects EACH schema.<tenant-table> reference and requires a
// scope token within a small line window. RLS (separate spec) is the real
// isolation backstop; this is the cheap CI net until then.
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs/walk";

const TENANT_LINE = /schema\.(orders|customers|providers)\b/;
// Any of these near the query proves a scope decision was deliberately made.
const SCOPE_TOKENS = [
  "whereShop",
  "scoped(",
  "orderAccessible",
  "canWrite",
  "orderInShop",
  "providerInShop",
  "shopId",
  "customerId", // customer-owned-row scoping (portal / estimates authed path)
  "shareToken", // capability-token auth for public links (estimates / pdf)
  "tenant-ok", // explicit escape hatch: `// tenant-ok: <reason>`
];
const WINDOW = 12; // lines after a tenant-table line to scan for a scope token

Deno.test(
  "every tenant-table query in a gateway route carries a shop scope",
  async () => {
    const offenders: string[] = [];
    const routesDir = new URL("./routes", import.meta.url).pathname;
    for await (const entry of walk(routesDir, { exts: [".ts"] })) {
      if (entry.name.endsWith("_test.ts")) continue;
      const lines = (await Deno.readTextFile(entry.path)).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!TENANT_LINE.test(lines[i])) continue;
        const windowText = lines.slice(i, i + WINDOW + 1).join("\n");
        if (!SCOPE_TOKENS.some((t) => windowText.includes(t))) {
          offenders.push(`${entry.name}:${i + 1}`);
        }
      }
    }
    assertEquals(
      offenders,
      [],
      `Unscoped tenant-table queries (add a scope predicate or a "// tenant-ok: <reason>" comment): ${
        offenders.join(", ")
      }`,
    );
  },
);
```

- [ ] **Step 2: Run it against the CURRENT tree**

Run: `cd apps/gateway && deno test src/tenant-guard_test.ts` Expected: ideally PASS. If it reports
offenders, each is either (a) a real scoping question — STOP and surface it to the user (possible
leak), or (b) a false positive where the scope token sits >12 lines from the query or is named
unconventionally. For (b): widen `WINDOW`, add the genuine token to `SCOPE_TOKENS`, or add
`// tenant-ok: <reason>` on the query line — never delete the table from the scan.

- [ ] **Step 3: Sanity-check the guard actually bites**

Temporarily add an unscoped query to a route (e.g. in `admin.ts`, a bare
`db.select().from(schema.orders)` with no scope token in the next 12 lines), run the test, confirm
it now FAILS and names that file:line. Then revert the temporary line.

Run: `cd apps/gateway && deno test src/tenant-guard_test.ts` Expected: FAIL on the temporary line,
PASS after revert.

- [ ] **Step 4: Commit**

```bash
git add apps/gateway/src/tenant-guard_test.ts
git commit -m "test(gateway): upgrade tenant guard to per-query shop-scope proximity scan"
```

---

## Final verification

- [ ] Full CI:
      `cd apps/hmls-web && bun run lint && bun run typecheck && bun run test && bun run build`
- [ ] `deno task check && deno task lint && deno task fmt:check`
- [ ] `cd apps/gateway && deno test` and `cd apps/agent && deno test`

---

## Out of scope / Task 4 — RLS (separate spec, ~1-month deadline)

The user's first external paying tenant is ~1 month out, so Postgres RLS (true defense-in-depth)
needs its own spec and lands before then. It is intentionally NOT in this plan because it carries a
blocking infra decision and deserves a dedicated brainstorm:

- **Blocking constraint:** the gateway talks to Supabase over a single **service-role** connection
  (`packages/shared/src/db/client.ts`), and service_role is `BYPASSRLS` — naive RLS policies do
  nothing. RLS requires either a dedicated **non-bypassrls** DB role for the gateway (new role +
  connection string + grants) with `FORCE ROW LEVEL SECURITY`, plus per-transaction
  `SET LOCAL app.shop_id = ...` threaded through every scoped query, and policies
  `USING (shop_id = current_setting('app.shop_id')::uuid)`.
- **Also deferred (Phase 2 per existing memory):** per-tenant customer rows / customer→shop entry
  for genuinely external tenants; today a customer reads their own orders across any shop
  (`tenant.ts:47`).
- Task 3 (this plan) is the stepping stone: app-level scoping must be provably correct before RLS
  sits behind it.

**Also explicitly deferred from this plan:** city-page → shop pre-routing (thread the landing
region's `shopSlug` into the chat so an order pre-associates with the right shop before the customer
types an address). Low value while the address is required and routing already runs at create time —
pull in only if QA shows landing-region context is being lost.
