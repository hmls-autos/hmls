# Admin Mechanics Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-scope admin surface under `/admin/mechanics` to list, create, edit, deactivate mechanics; view and edit their schedules; and reassign bookings. Visual style is a "Fleet Board" — a grid of rich cards with utilization bars, plus a per-mechanic detail page with a 7-day schedule strip.

**Architecture:**
- New Hono sub-router `apps/gateway/src/routes/admin-mechanics.ts`, mounted at `/api/admin/mechanics`, guarded by the existing `requireAdmin` middleware. No schema changes.
- Aggregate stats (week utilization, isOnJobNow, earnings30d) live in a pure helper module (`apps/gateway/src/lib/mechanic-stats.ts`) that is unit-tested, then composed into list/detail endpoints.
- Frontend uses the existing SWR + `authFetch` pattern. New hook file `hooks/useAdminMechanics.ts`. New pages under `app/(admin)/admin/mechanics/`.

**Tech Stack:** Deno + Hono + Drizzle ORM (Postgres) for the gateway; Next.js 16 + React 19 + Tailwind 4 + SWR for the web; existing shadcn/ui components (Card, Dialog, Button, Badge, Skeleton).

---

## Spec

See `docs/superpowers/specs/2026-04-19-admin-mechanics-design.md`. Summary of backend endpoints (all under `/api/admin/mechanics`, admin-gated):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | List mechanics with aggregate stats |
| POST | `/` | Create a mechanic |
| GET | `/:id` | Full profile |
| PATCH | `/:id` | Edit profile fields |
| DELETE | `/:id` | Soft delete (sets `isActive=false`) |
| GET | `/:id/availability` | Weekly hours |
| PUT | `/:id/availability` | Overwrite weekly hours |
| GET | `/:id/overrides` | Schedule overrides |
| POST | `/:id/overrides` | Upsert override |
| DELETE | `/:id/overrides/:overrideId` | Delete override |
| GET | `/:id/bookings` | Mechanic's bookings (supports `from`/`to`) |
| POST | `/bookings/:bookingId/reassign` | Reassign booking to `{ providerId }` |

---

## File Structure

### Backend (create)

- `apps/gateway/src/lib/mechanic-stats.ts` — pure functions for stats computation (utilization, isOnJobNow, earnings derivation rules). ~150 lines.
- `apps/gateway/src/lib/mechanic-stats_test.ts` — Deno unit tests for the above.
- `apps/gateway/src/routes/admin-mechanics.ts` — Hono sub-router with all endpoints. ~400 lines.
- `apps/gateway/src/routes/admin-mechanics_test.ts` — smoke tests for unauthorized access + input validation.

### Backend (modify)

- `apps/gateway/src/hmls-app.ts` — import and mount the new sub-router at `/api/admin/mechanics`.

### Frontend (create)

- `apps/hmls-web/hooks/useAdminMechanics.ts` — SWR hooks + types.
- `apps/hmls-web/app/(admin)/admin/mechanics/page.tsx` — Fleet board.
- `apps/hmls-web/app/(admin)/admin/mechanics/[id]/page.tsx` — Detail page.
- `apps/hmls-web/components/admin/mechanics/MechanicCard.tsx` — one card in the fleet grid.
- `apps/hmls-web/components/admin/mechanics/UtilizationBar.tsx` — colored bar.
- `apps/hmls-web/components/admin/mechanics/AddMechanicDialog.tsx`
- `apps/hmls-web/components/admin/mechanics/EditProfileForm.tsx` — inline edit form.
- `apps/hmls-web/components/admin/mechanics/ScheduleStrip.tsx` — 7-day schedule block.
- `apps/hmls-web/components/admin/mechanics/EditHoursDialog.tsx`
- `apps/hmls-web/components/admin/mechanics/AddTimeOffDialog.tsx`
- `apps/hmls-web/components/admin/mechanics/ReassignBookingDialog.tsx`

### Frontend (modify)

- `apps/hmls-web/app/(admin)/admin/layout.tsx` — add "Mechanics" nav item (Wrench icon).
- `apps/hmls-web/app/(admin)/admin/orders/[id]/page.tsx` — wire the ReassignBookingDialog into this page (per spec: reassign is discoverable from order detail too).

---

## Testing Strategy

- **Backend:** TDD for `mechanic-stats.ts` using Deno's built-in test runner — the file pattern `*_test.ts` matches `apps/gateway/src/routes/chat_test.ts`. For the HTTP routes, match the `chat_test.ts` style: 401/400 path assertions that don't require a live DB. DB-backed happy paths are verified via manual QA with the dev server (see final task).
- **Frontend:** This project does not have a frontend unit-test framework set up (grep returned no `*.test.ts(x)` under `apps/hmls-web`). Do not add one. Verification is via manual QA (dev server + browser) and the CI suite (`bun run lint`, `bun run typecheck`, `bun run build`).

---

## Task 1: Backend — pure stats helpers

**Files:**
- Create: `apps/gateway/src/lib/mechanic-stats.ts`
- Test: `apps/gateway/src/lib/mechanic-stats_test.ts`

**What this covers:** the only real business logic on the backend is the aggregate math. Isolating it into pure functions lets us unit-test without spinning up DB.

- [ ] **Step 1: Write the failing tests**

Create `apps/gateway/src/lib/mechanic-stats_test.ts`:

```ts
import { assertEquals, assertAlmostEquals } from "@std/assert";
import {
  availableMinutesForWeek,
  bookedMinutesForWeek,
  computeUtilization,
  isOnJobNow,
  startOfWeek,
  endOfWeek,
} from "./mechanic-stats.ts";

// Helper: freeze "now" to a known Monday 10:00 UTC.
const NOW = new Date("2026-04-20T10:00:00.000Z"); // Monday

Deno.test("startOfWeek returns Monday 00:00 local-UTC for a mid-week date", () => {
  const wed = new Date("2026-04-22T15:30:00.000Z");
  const start = startOfWeek(wed);
  assertEquals(start.toISOString(), "2026-04-20T00:00:00.000Z");
});

Deno.test("endOfWeek returns next Monday 00:00 UTC (exclusive)", () => {
  const end = endOfWeek(NOW);
  assertEquals(end.toISOString(), "2026-04-27T00:00:00.000Z");
});

Deno.test("availableMinutesForWeek sums weekly hours across 7 days", () => {
  // 9am-5pm Mon-Fri = 5 days * 8h = 40h = 2400 min
  const weekly = [
    { dayOfWeek: 1, startTime: "09:00:00", endTime: "17:00:00" },
    { dayOfWeek: 2, startTime: "09:00:00", endTime: "17:00:00" },
    { dayOfWeek: 3, startTime: "09:00:00", endTime: "17:00:00" },
    { dayOfWeek: 4, startTime: "09:00:00", endTime: "17:00:00" },
    { dayOfWeek: 5, startTime: "09:00:00", endTime: "17:00:00" },
  ];
  const mins = availableMinutesForWeek(weekly, [], NOW);
  assertEquals(mins, 2400);
});

Deno.test("availableMinutesForWeek subtracts full-day unavailable overrides", () => {
  const weekly = [
    { dayOfWeek: 1, startTime: "09:00:00", endTime: "17:00:00" }, // 480
    { dayOfWeek: 2, startTime: "09:00:00", endTime: "17:00:00" }, // 480
  ];
  // Tuesday this week is 2026-04-21. Mark it unavailable.
  const overrides = [
    {
      overrideDate: "2026-04-21",
      isAvailable: false,
      startTime: null,
      endTime: null,
    },
  ];
  const mins = availableMinutesForWeek(weekly, overrides, NOW);
  assertEquals(mins, 480);
});

Deno.test("availableMinutesForWeek adds extra-hours overrides on non-working days", () => {
  const weekly: { dayOfWeek: number; startTime: string; endTime: string }[] =
    [];
  // Saturday 2026-04-25 extra shift 10:00-14:00 = 240 min
  const overrides = [
    {
      overrideDate: "2026-04-25",
      isAvailable: true,
      startTime: "10:00:00",
      endTime: "14:00:00",
    },
  ];
  const mins = availableMinutesForWeek(weekly, overrides, NOW);
  assertEquals(mins, 240);
});

Deno.test("bookedMinutesForWeek sums durations of bookings in the week", () => {
  const bookings = [
    {
      scheduledAt: new Date("2026-04-21T14:00:00.000Z"),
      durationMinutes: 60,
      status: "confirmed",
    },
    {
      scheduledAt: new Date("2026-04-23T10:00:00.000Z"),
      durationMinutes: 90,
      status: "completed",
    },
    // Next week — excluded
    {
      scheduledAt: new Date("2026-04-28T10:00:00.000Z"),
      durationMinutes: 60,
      status: "confirmed",
    },
    // Rejected — excluded
    {
      scheduledAt: new Date("2026-04-22T10:00:00.000Z"),
      durationMinutes: 60,
      status: "rejected",
    },
  ];
  assertEquals(bookedMinutesForWeek(bookings, NOW), 150);
});

Deno.test("computeUtilization returns null when available is 0", () => {
  assertEquals(computeUtilization(0, 100), null);
});

Deno.test("computeUtilization rounds to integer percent", () => {
  assertAlmostEquals(computeUtilization(480, 120)!, 25, 0.01);
});

Deno.test("isOnJobNow returns true when current time is inside a confirmed booking", () => {
  const bookings = [
    {
      scheduledAt: new Date("2026-04-20T09:30:00.000Z"),
      durationMinutes: 60,
      status: "confirmed",
    },
  ];
  assertEquals(isOnJobNow(bookings, NOW), true);
});

Deno.test("isOnJobNow ignores non-confirmed bookings", () => {
  const bookings = [
    {
      scheduledAt: new Date("2026-04-20T09:30:00.000Z"),
      durationMinutes: 60,
      status: "requested",
    },
  ];
  assertEquals(isOnJobNow(bookings, NOW), false);
});

Deno.test("isOnJobNow returns false when no booking covers now", () => {
  const bookings = [
    {
      scheduledAt: new Date("2026-04-20T12:00:00.000Z"),
      durationMinutes: 60,
      status: "confirmed",
    },
  ];
  assertEquals(isOnJobNow(bookings, NOW), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test apps/gateway/src/lib/mechanic-stats_test.ts`
Expected: FAIL — module `./mechanic-stats.ts` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `apps/gateway/src/lib/mechanic-stats.ts`:

```ts
/**
 * Pure helpers for mechanic aggregate stats. No DB imports — callers pass in
 * already-fetched rows. Week is defined as Monday 00:00 UTC (inclusive) →
 * next Monday 00:00 UTC (exclusive). Times on provider_availability /
 * overrides are HH:MM[:SS] strings, interpreted as UTC-of-the-day here; this
 * matches how the mechanic self-service UI treats them today.
 */

export interface WeeklyRow {
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  startTime: string; // "HH:MM:SS" or "HH:MM"
  endTime: string;
}

export interface OverrideRow {
  overrideDate: string; // "YYYY-MM-DD"
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
}

export interface BookingRow {
  scheduledAt: Date;
  durationMinutes: number;
  status: string;
}

export function startOfWeek(d: Date): Date {
  // JS getUTCDay: 0=Sun..6=Sat. Convert to Monday-based offset.
  const dayOfWeek = d.getUTCDay();
  const mondayOffset = (dayOfWeek + 6) % 7; // Mon -> 0, Sun -> 6
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  return start;
}

export function endOfWeek(d: Date): Date {
  const start = startOfWeek(d);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return end;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

export function availableMinutesForWeek(
  weekly: WeeklyRow[],
  overrides: OverrideRow[],
  now: Date,
): number {
  const start = startOfWeek(now);
  const end = endOfWeek(now);

  // Map weekly rows by dayOfWeek for fast lookup.
  const weeklyByDow = new Map<number, WeeklyRow[]>();
  for (const row of weekly) {
    const list = weeklyByDow.get(row.dayOfWeek) ?? [];
    list.push(row);
    weeklyByDow.set(row.dayOfWeek, list);
  }

  // Build a set of overrideDate strings in this week for fast lookup.
  const overridesByDate = new Map<string, OverrideRow>();
  for (const o of overrides) {
    overridesByDate.set(o.overrideDate, o);
  }

  let minutes = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + i);
    if (day >= end) break;

    const dow = day.getUTCDay();
    const dateKey = day.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const override = overridesByDate.get(dateKey);

    if (override) {
      if (override.isAvailable && override.startTime && override.endTime) {
        minutes += timeToMinutes(override.endTime) -
          timeToMinutes(override.startTime);
      }
      // Unavailable override cancels the day entirely — skip weekly rows.
      continue;
    }

    for (const row of weeklyByDow.get(dow) ?? []) {
      minutes += timeToMinutes(row.endTime) - timeToMinutes(row.startTime);
    }
  }
  return minutes;
}

export function bookedMinutesForWeek(
  bookings: BookingRow[],
  now: Date,
): number {
  const start = startOfWeek(now);
  const end = endOfWeek(now);

  let minutes = 0;
  for (const b of bookings) {
    if (b.status !== "confirmed" && b.status !== "completed") continue;
    if (b.scheduledAt < start || b.scheduledAt >= end) continue;
    minutes += b.durationMinutes;
  }
  return minutes;
}

/** Returns integer percent utilization, or null when available == 0. */
export function computeUtilization(
  availableMinutes: number,
  bookedMinutes: number,
): number | null {
  if (availableMinutes <= 0) return null;
  return Math.round((bookedMinutes / availableMinutes) * 100);
}

export function isOnJobNow(bookings: BookingRow[], now: Date): boolean {
  for (const b of bookings) {
    if (b.status !== "confirmed") continue;
    const end = new Date(b.scheduledAt.getTime() + b.durationMinutes * 60_000);
    if (b.scheduledAt <= now && now < end) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test apps/gateway/src/lib/mechanic-stats_test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/gateway/src/lib/mechanic-stats.ts apps/gateway/src/lib/mechanic-stats_test.ts
git commit -m "feat(gateway): pure mechanic stats helpers with tests"
```

---

## Task 2: Backend — admin-mechanics router (list + CRUD)

**Files:**
- Create: `apps/gateway/src/routes/admin-mechanics.ts`

This task implements only the list + per-mechanic CRUD endpoints. Availability, overrides, bookings, and reassign go in Tasks 3–5. Splitting keeps review reasonable.

- [ ] **Step 1: Create the router file with imports and admin-guard**

Create `apps/gateway/src/routes/admin-mechanics.ts`:

```ts
import { Hono } from "hono";
import { and, asc, between, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@hmls/agent/db";
import { type AdminEnv, requireAdmin } from "../middleware/admin.ts";
import {
  availableMinutesForWeek,
  bookedMinutesForWeek,
  computeUtilization,
  isOnJobNow,
} from "../lib/mechanic-stats.ts";

const adminMechanics = new Hono<AdminEnv>();

adminMechanics.use("*", requireAdmin);

export { adminMechanics };
```

- [ ] **Step 2: Add `GET /` list endpoint with aggregate stats**

Append to `apps/gateway/src/routes/admin-mechanics.ts`:

```ts
// GET / — list mechanics with aggregate stats
adminMechanics.get("/", async (c) => {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - 14);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const providers = await db
    .select()
    .from(schema.providers)
    .orderBy(desc(schema.providers.isActive), asc(schema.providers.name));

  if (providers.length === 0) return c.json([]);

  const providerIds = providers.map((p) => p.id);

  // Fetch all inputs in parallel.
  const [
    availability,
    overrides,
    weekBookings,
    allBookings,
    paidOrders,
    upcomingCounts,
    nextBookings,
  ] = await Promise.all([
    db
      .select()
      .from(schema.providerAvailability)
      .where(inArray(schema.providerAvailability.providerId, providerIds)),
    db
      .select()
      .from(schema.providerScheduleOverrides)
      .where(
        inArray(schema.providerScheduleOverrides.providerId, providerIds),
      ),
    db
      .select({
        providerId: schema.bookings.providerId,
        scheduledAt: schema.bookings.scheduledAt,
        durationMinutes: schema.bookings.durationMinutes,
        status: schema.bookings.status,
      })
      .from(schema.bookings)
      .where(
        and(
          inArray(schema.bookings.providerId, providerIds),
          gte(schema.bookings.scheduledAt, weekStart),
        ),
      ),
    // Snapshot of all their bookings for isOnJobNow (small window)
    db
      .select({
        providerId: schema.bookings.providerId,
        scheduledAt: schema.bookings.scheduledAt,
        durationMinutes: schema.bookings.durationMinutes,
        status: schema.bookings.status,
      })
      .from(schema.bookings)
      .where(
        and(
          inArray(schema.bookings.providerId, providerIds),
          between(
            schema.bookings.scheduledAt,
            new Date(now.getTime() - 24 * 60 * 60 * 1000),
            new Date(now.getTime() + 24 * 60 * 60 * 1000),
          ),
        ),
      ),
    // Earnings 30d: orders.bookingId → bookings.providerId, orders paid recently
    db
      .select({
        providerId: schema.bookings.providerId,
        amountCents: sql<number>`COALESCE(${schema.orders.capturedAmountCents}, ${schema.orders.subtotalCents})`,
      })
      .from(schema.orders)
      .innerJoin(
        schema.bookings,
        eq(schema.orders.bookingId, schema.bookings.id),
      )
      .where(
        and(
          inArray(schema.bookings.providerId, providerIds),
          sql`${schema.orders.status} IN ('paid', 'completed', 'archived')`,
          gte(schema.orders.createdAt, thirtyDaysAgo),
        ),
      ),
    db
      .select({
        providerId: schema.bookings.providerId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.bookings)
      .where(
        and(
          inArray(schema.bookings.providerId, providerIds),
          gte(schema.bookings.scheduledAt, now),
          sql`${schema.bookings.status} IN ('requested', 'confirmed')`,
        ),
      )
      .groupBy(schema.bookings.providerId),
    db
      .select({
        providerId: schema.bookings.providerId,
        scheduledAt: sql<Date>`MIN(${schema.bookings.scheduledAt})`,
      })
      .from(schema.bookings)
      .where(
        and(
          inArray(schema.bookings.providerId, providerIds),
          gte(schema.bookings.scheduledAt, now),
          sql`${schema.bookings.status} IN ('requested', 'confirmed')`,
        ),
      )
      .groupBy(schema.bookings.providerId),
  ]);

  // Group inputs by providerId for per-row composition.
  const byId = <T extends { providerId: number | null }>(
    rows: T[],
  ): Map<number, T[]> => {
    const m = new Map<number, T[]>();
    for (const r of rows) {
      if (r.providerId == null) continue;
      const list = m.get(r.providerId) ?? [];
      list.push(r);
      m.set(r.providerId, list);
    }
    return m;
  };

  const availByProvider = byId(availability);
  const overridesByProvider = byId(overrides);
  const weekByProvider = byId(weekBookings);
  const allByProvider = byId(allBookings);
  const earningsByProvider = new Map<number, number>();
  for (const row of paidOrders) {
    if (row.providerId == null) continue;
    earningsByProvider.set(
      row.providerId,
      (earningsByProvider.get(row.providerId) ?? 0) + Number(row.amountCents),
    );
  }
  const upcomingCountByProvider = new Map<number, number>();
  for (const row of upcomingCounts) {
    if (row.providerId == null) continue;
    upcomingCountByProvider.set(row.providerId, row.count);
  }
  const nextByProvider = new Map<number, Date>();
  for (const row of nextBookings) {
    if (row.providerId == null) continue;
    nextByProvider.set(row.providerId, row.scheduledAt);
  }

  const result = providers.map((p) => {
    const avail = availByProvider.get(p.id) ?? [];
    const ovr = overridesByProvider.get(p.id) ?? [];
    const weekB = (weekByProvider.get(p.id) ?? []).map((b) => ({
      scheduledAt: new Date(b.scheduledAt),
      durationMinutes: b.durationMinutes,
      status: b.status,
    }));
    const allB = (allByProvider.get(p.id) ?? []).map((b) => ({
      scheduledAt: new Date(b.scheduledAt),
      durationMinutes: b.durationMinutes,
      status: b.status,
    }));

    const availableMinutes = availableMinutesForWeek(avail, ovr, now);
    const bookedMinutes = bookedMinutesForWeek(weekB, now);
    return {
      ...p,
      weekUtilization: computeUtilization(availableMinutes, bookedMinutes),
      isOnJobNow: isOnJobNow(allB, now),
      upcomingBookingsCount: upcomingCountByProvider.get(p.id) ?? 0,
      earnings30d: earningsByProvider.get(p.id) ?? 0,
      nextBookingAt: nextByProvider.get(p.id) ?? null,
    };
  });

  return c.json(result);
});
```

- [ ] **Step 3: Add `POST /` create endpoint**

Append:

```ts
// POST / — create a new mechanic
adminMechanics.post("/", async (c) => {
  const body = await c.req.json<{
    name?: string;
    email?: string;
    phone?: string;
    timezone?: string;
    serviceRadiusMiles?: number;
    homeBaseLat?: number | string | null;
    homeBaseLng?: number | string | null;
    specialties?: unknown;
    isActive?: boolean;
    authUserId?: string;
  }>().catch(() => null);

  if (!body?.name) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "name is required" } },
      400,
    );
  }

  const [created] = await db
    .insert(schema.providers)
    .values({
      name: body.name,
      email: body.email ?? null,
      phone: body.phone ?? null,
      timezone: body.timezone ?? "America/Los_Angeles",
      serviceRadiusMiles: body.serviceRadiusMiles ?? 30,
      homeBaseLat: body.homeBaseLat == null
        ? null
        : String(body.homeBaseLat),
      homeBaseLng: body.homeBaseLng == null
        ? null
        : String(body.homeBaseLng),
      specialties: body.specialties ?? null,
      isActive: body.isActive ?? true,
      authUserId: body.authUserId ?? null,
    })
    .returning();

  return c.json(created, 201);
});
```

- [ ] **Step 4: Add `GET /:id`, `PATCH /:id`, `DELETE /:id`**

Append:

```ts
// GET /:id — single mechanic
adminMechanics.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid mechanic ID" } },
      400,
    );
  }

  const [provider] = await db
    .select()
    .from(schema.providers)
    .where(eq(schema.providers.id, id))
    .limit(1);

  if (!provider) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Mechanic not found" } },
      404,
    );
  }
  return c.json(provider);
});

// PATCH /:id — edit profile fields
adminMechanics.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid mechanic ID" } },
      400,
    );
  }

  const body = await c.req.json<{
    name?: string;
    email?: string | null;
    phone?: string | null;
    timezone?: string;
    serviceRadiusMiles?: number;
    homeBaseLat?: number | string | null;
    homeBaseLng?: number | string | null;
    specialties?: unknown;
    isActive?: boolean;
    authUserId?: string | null;
  }>().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.email !== undefined) updates.email = body.email;
  if (body.phone !== undefined) updates.phone = body.phone;
  if (body.timezone !== undefined) updates.timezone = body.timezone;
  if (body.serviceRadiusMiles !== undefined) {
    updates.serviceRadiusMiles = body.serviceRadiusMiles;
  }
  if (body.homeBaseLat !== undefined) {
    updates.homeBaseLat = body.homeBaseLat == null
      ? null
      : String(body.homeBaseLat);
  }
  if (body.homeBaseLng !== undefined) {
    updates.homeBaseLng = body.homeBaseLng == null
      ? null
      : String(body.homeBaseLng);
  }
  if (body.specialties !== undefined) updates.specialties = body.specialties;
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.authUserId !== undefined) updates.authUserId = body.authUserId;

  if (Object.keys(updates).length === 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "No fields to update" } },
      400,
    );
  }

  const [updated] = await db
    .update(schema.providers)
    .set(updates)
    .where(eq(schema.providers.id, id))
    .returning();

  if (!updated) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Mechanic not found" } },
      404,
    );
  }
  return c.json(updated);
});

// DELETE /:id — soft delete (sets isActive=false). Bookings reference this
// row, so we never hard-delete.
adminMechanics.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid mechanic ID" } },
      400,
    );
  }

  const [updated] = await db
    .update(schema.providers)
    .set({ isActive: false })
    .where(eq(schema.providers.id, id))
    .returning();

  if (!updated) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Mechanic not found" } },
      404,
    );
  }
  return c.json({ success: true });
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/gateway/src/routes/admin-mechanics.ts
git commit -m "feat(gateway): admin mechanics CRUD endpoints"
```

---

## Task 3: Backend — availability + overrides endpoints

**Files:**
- Modify: `apps/gateway/src/routes/admin-mechanics.ts`

- [ ] **Step 1: Add availability read/write endpoints**

Append to `apps/gateway/src/routes/admin-mechanics.ts` (before the `export`):

```ts
// GET /:id/availability — read weekly hours
adminMechanics.get("/:id/availability", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid mechanic ID" } },
      400,
    );
  }
  const rows = await db
    .select()
    .from(schema.providerAvailability)
    .where(eq(schema.providerAvailability.providerId, id))
    .orderBy(asc(schema.providerAvailability.dayOfWeek));
  return c.json(rows);
});

// PUT /:id/availability — replace weekly hours atomically
adminMechanics.put("/:id/availability", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid mechanic ID" } },
      400,
    );
  }

  const body = await c.req.json<{
    availability: Array<
      { dayOfWeek: number; startTime: string; endTime: string }
    >;
  }>().catch(() => null);

  if (!body?.availability || !Array.isArray(body.availability)) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "availability array required",
        },
      },
      400,
    );
  }

  for (const row of body.availability) {
    if (
      !Number.isInteger(row.dayOfWeek) ||
      row.dayOfWeek < 0 ||
      row.dayOfWeek > 6 ||
      !/^\d{2}:\d{2}(:\d{2})?$/.test(row.startTime) ||
      !/^\d{2}:\d{2}(:\d{2})?$/.test(row.endTime)
    ) {
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "Invalid row: dayOfWeek 0-6, HH:MM[:SS] times required",
          },
        },
        400,
      );
    }
    if (row.endTime <= row.startTime) {
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "endTime must be after startTime",
          },
        },
        400,
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.providerAvailability)
      .where(eq(schema.providerAvailability.providerId, id));
    if (body.availability.length > 0) {
      await tx.insert(schema.providerAvailability).values(
        body.availability.map((a) => ({ providerId: id, ...a })),
      );
    }
  });

  const rows = await db
    .select()
    .from(schema.providerAvailability)
    .where(eq(schema.providerAvailability.providerId, id))
    .orderBy(asc(schema.providerAvailability.dayOfWeek));
  return c.json(rows);
});
```

- [ ] **Step 2: Add overrides endpoints**

Append:

```ts
// GET /:id/overrides — read schedule overrides
adminMechanics.get("/:id/overrides", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid mechanic ID" } },
      400,
    );
  }
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions = [eq(schema.providerScheduleOverrides.providerId, id)];
  if (from) {
    conditions.push(
      gte(schema.providerScheduleOverrides.overrideDate, from),
    );
  }
  if (to) {
    conditions.push(lte(schema.providerScheduleOverrides.overrideDate, to));
  }

  const rows = await db
    .select()
    .from(schema.providerScheduleOverrides)
    .where(and(...conditions))
    .orderBy(asc(schema.providerScheduleOverrides.overrideDate));
  return c.json(rows);
});

// POST /:id/overrides — upsert override (one per date)
adminMechanics.post("/:id/overrides", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid mechanic ID" } },
      400,
    );
  }

  const body = await c.req.json<{
    overrideDate: string;
    isAvailable: boolean;
    startTime?: string;
    endTime?: string;
    reason?: string;
  }>().catch(() => null);

  if (!body?.overrideDate || typeof body.isAvailable !== "boolean") {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "overrideDate (YYYY-MM-DD) and isAvailable required",
        },
      },
      400,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.overrideDate)) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "overrideDate must be YYYY-MM-DD",
        },
      },
      400,
    );
  }
  if (body.isAvailable && (!body.startTime || !body.endTime)) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "startTime and endTime required when isAvailable is true",
        },
      },
      400,
    );
  }

  await db
    .delete(schema.providerScheduleOverrides)
    .where(
      and(
        eq(schema.providerScheduleOverrides.providerId, id),
        eq(schema.providerScheduleOverrides.overrideDate, body.overrideDate),
      ),
    );

  const [created] = await db
    .insert(schema.providerScheduleOverrides)
    .values({
      providerId: id,
      overrideDate: body.overrideDate,
      isAvailable: body.isAvailable,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      reason: body.reason ?? null,
    })
    .returning();
  return c.json(created, 201);
});

// DELETE /:id/overrides/:overrideId — delete single override
adminMechanics.delete("/:id/overrides/:overrideId", async (c) => {
  const id = Number(c.req.param("id"));
  const overrideId = Number(c.req.param("overrideId"));
  if (
    !Number.isInteger(id) || id <= 0 ||
    !Number.isInteger(overrideId) || overrideId <= 0
  ) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid ID" } },
      400,
    );
  }

  const result = await db
    .delete(schema.providerScheduleOverrides)
    .where(
      and(
        eq(schema.providerScheduleOverrides.id, overrideId),
        eq(schema.providerScheduleOverrides.providerId, id),
      ),
    )
    .returning({ id: schema.providerScheduleOverrides.id });

  if (result.length === 0) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Override not found" } },
      404,
    );
  }
  return c.json({ ok: true });
});
```

- [ ] **Step 3: Run `deno check`**

Run: `deno task check`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add apps/gateway/src/routes/admin-mechanics.ts
git commit -m "feat(gateway): admin availability + override endpoints"
```

---

## Task 4: Backend — bookings + reassign endpoints

**Files:**
- Modify: `apps/gateway/src/routes/admin-mechanics.ts`

- [ ] **Step 1: Add `GET /:id/bookings`**

Append (before the `export`):

```ts
// GET /:id/bookings — bookings assigned to this mechanic, with customer join
adminMechanics.get("/:id/bookings", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid mechanic ID" } },
      400,
    );
  }
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions = [eq(schema.bookings.providerId, id)];
  if (from && to) {
    conditions.push(
      between(schema.bookings.scheduledAt, new Date(from), new Date(to)),
    );
  } else if (from) {
    conditions.push(gte(schema.bookings.scheduledAt, new Date(from)));
  } else if (to) {
    conditions.push(lte(schema.bookings.scheduledAt, new Date(to)));
  }

  const rows = await db
    .select({
      booking: schema.bookings,
      customerName: schema.customers.name,
      customerEmail: schema.customers.email,
      customerPhone: schema.customers.phone,
    })
    .from(schema.bookings)
    .leftJoin(
      schema.customers,
      eq(schema.bookings.customerId, schema.customers.id),
    )
    .where(and(...conditions))
    .orderBy(asc(schema.bookings.scheduledAt))
    .limit(200);

  return c.json(
    rows.map((r) => ({
      ...r.booking,
      customer: {
        name: r.customerName,
        email: r.customerEmail,
        phone: r.customerPhone,
      },
    })),
  );
});
```

- [ ] **Step 2: Add `POST /bookings/:bookingId/reassign`**

Append:

```ts
// POST /bookings/:bookingId/reassign — change assigned mechanic
adminMechanics.post("/bookings/:bookingId/reassign", async (c) => {
  const bookingId = Number(c.req.param("bookingId"));
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid booking ID" } },
      400,
    );
  }

  const body = await c.req.json<{ providerId: number; force?: boolean }>()
    .catch(() => null);

  if (!body || !Number.isInteger(body.providerId) || body.providerId <= 0) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "providerId (positive integer) is required",
        },
      },
      400,
    );
  }

  const [booking] = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.id, bookingId))
    .limit(1);
  if (!booking) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Booking not found" } },
      404,
    );
  }
  if (booking.providerId === body.providerId) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "Booking already assigned to that mechanic",
        },
      },
      400,
    );
  }

  const [provider] = await db
    .select()
    .from(schema.providers)
    .where(eq(schema.providers.id, body.providerId))
    .limit(1);
  if (!provider) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "Target mechanic not found" } },
      404,
    );
  }
  if (!provider.isActive && !body.force) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message:
            "Target mechanic is inactive. Pass force:true to reassign anyway.",
        },
      },
      400,
    );
  }

  const [updated] = await db
    .update(schema.bookings)
    .set({ providerId: body.providerId, updatedAt: new Date() })
    .where(eq(schema.bookings.id, bookingId))
    .returning();

  return c.json(updated);
});
```

- [ ] **Step 3: Run `deno check`**

Run: `deno task check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/gateway/src/routes/admin-mechanics.ts
git commit -m "feat(gateway): admin bookings list + reassign endpoint"
```

---

## Task 5: Backend — mount router + smoke tests

**Files:**
- Modify: `apps/gateway/src/hmls-app.ts`
- Create: `apps/gateway/src/routes/admin-mechanics_test.ts`

- [ ] **Step 1: Write the failing smoke tests**

Create `apps/gateway/src/routes/admin-mechanics_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { adminMechanics } from "./admin-mechanics.ts";

// The 401 path short-circuits before any DB call runs — no env vars needed.

Deno.test("admin-mechanics: rejects missing Authorization header", async () => {
  const res = await adminMechanics.request("/", { method: "GET" });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHORIZED");
});

Deno.test("admin-mechanics: rejects non-Bearer auth", async () => {
  const res = await adminMechanics.request("/", {
    method: "GET",
    headers: { authorization: "Basic dXNlcjpwYXNz" },
  });
  assertEquals(res.status, 401);
});

Deno.test("admin-mechanics: rejects reassign missing header", async () => {
  const res = await adminMechanics.request("/bookings/1/reassign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: 1 }),
  });
  assertEquals(res.status, 401);
});
```

- [ ] **Step 2: Run tests to confirm they pass (the router already rejects unauthenticated requests)**

Run: `deno test apps/gateway/src/routes/admin-mechanics_test.ts`
Expected: PASS (3 tests). The router is self-contained so no mounting needed to validate the auth boundary.

- [ ] **Step 3: Mount the router in `hmls-app.ts`**

Edit `apps/gateway/src/hmls-app.ts`. In the imports block near the top, add:

```ts
import { adminMechanics } from "./routes/admin-mechanics.ts";
```

In the route-mount block (around the other `app.route(...)` calls), add (place it right after `app.route("/api/admin/orders", orders);`):

```ts
  app.route("/api/admin/mechanics", adminMechanics);
```

- [ ] **Step 4: Run the full Deno check + lint + tests**

Run: `deno task check && deno task lint && deno test apps/gateway`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gateway/src/hmls-app.ts apps/gateway/src/routes/admin-mechanics_test.ts
git commit -m "feat(gateway): mount admin mechanics router + smoke tests"
```

---

## Task 6: Frontend — data layer hook

**Files:**
- Create: `apps/hmls-web/hooks/useAdminMechanics.ts`

- [ ] **Step 1: Create the hook module**

Create `apps/hmls-web/hooks/useAdminMechanics.ts`:

```ts
import useSWR from "swr";
import { authFetch, fetcher } from "@/lib/fetcher";
import type { Booking } from "@/lib/types";

export interface Mechanic {
  id: number;
  authUserId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  specialties: unknown;
  isActive: boolean;
  serviceRadiusMiles: number | null;
  homeBaseLat: string | null;
  homeBaseLng: string | null;
  timezone: string;
  createdAt: string;
}

export interface MechanicListRow extends Mechanic {
  weekUtilization: number | null;
  isOnJobNow: boolean;
  upcomingBookingsCount: number;
  earnings30d: number;
  nextBookingAt: string | null;
}

export interface WeeklyRow {
  id: number;
  providerId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface ScheduleOverride {
  id: number;
  providerId: number;
  overrideDate: string;
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

export type MechanicBookingRow = Booking & {
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
};

export function useAdminMechanics() {
  const { data, error, isLoading, mutate } = useSWR<MechanicListRow[]>(
    "/api/admin/mechanics",
    fetcher,
  );

  async function createMechanic(payload: {
    name: string;
    email?: string;
    phone?: string;
    timezone?: string;
    serviceRadiusMiles?: number;
    homeBaseLat?: number | null;
    homeBaseLng?: number | null;
    specialties?: string[];
  }) {
    const created = await authFetch<Mechanic>("/api/admin/mechanics", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await mutate();
    return created;
  }

  return {
    mechanics: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
    createMechanic,
  };
}

export function useAdminMechanic(id: number | null) {
  const { data, error, isLoading, mutate } = useSWR<Mechanic>(
    id ? `/api/admin/mechanics/${id}` : null,
    fetcher,
  );

  async function updateMechanic(patch: Partial<Mechanic>) {
    if (!id) throw new Error("No mechanic id");
    await authFetch(`/api/admin/mechanics/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await mutate();
  }

  async function deactivate() {
    if (!id) throw new Error("No mechanic id");
    await authFetch(`/api/admin/mechanics/${id}`, { method: "DELETE" });
    await mutate();
  }

  return {
    mechanic: data,
    isLoading,
    isError: !!error,
    mutate,
    updateMechanic,
    deactivate,
  };
}

export function useAdminMechanicAvailability(id: number | null) {
  const { data, error, isLoading, mutate } = useSWR<WeeklyRow[]>(
    id ? `/api/admin/mechanics/${id}/availability` : null,
    fetcher,
  );

  async function saveAvailability(
    rows: Array<Pick<WeeklyRow, "dayOfWeek" | "startTime" | "endTime">>,
  ) {
    if (!id) throw new Error("No mechanic id");
    await authFetch(`/api/admin/mechanics/${id}/availability`, {
      method: "PUT",
      body: JSON.stringify({ availability: rows }),
    });
    await mutate();
  }

  return {
    availability: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
    saveAvailability,
  };
}

export function useAdminMechanicOverrides(
  id: number | null,
  from?: string,
  to?: string,
) {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const qs = p.toString() ? `?${p.toString()}` : "";
  const { data, error, isLoading, mutate } = useSWR<ScheduleOverride[]>(
    id ? `/api/admin/mechanics/${id}/overrides${qs}` : null,
    fetcher,
  );

  async function addOverride(payload: {
    overrideDate: string;
    isAvailable: boolean;
    startTime?: string;
    endTime?: string;
    reason?: string;
  }) {
    if (!id) throw new Error("No mechanic id");
    await authFetch(`/api/admin/mechanics/${id}/overrides`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await mutate();
  }

  async function deleteOverride(overrideId: number) {
    if (!id) throw new Error("No mechanic id");
    await authFetch(
      `/api/admin/mechanics/${id}/overrides/${overrideId}`,
      { method: "DELETE" },
    );
    await mutate();
  }

  return {
    overrides: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
    addOverride,
    deleteOverride,
  };
}

export function useAdminMechanicBookings(
  id: number | null,
  from?: string,
  to?: string,
) {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const qs = p.toString() ? `?${p.toString()}` : "";
  const { data, error, isLoading, mutate } = useSWR<MechanicBookingRow[]>(
    id ? `/api/admin/mechanics/${id}/bookings${qs}` : null,
    fetcher,
  );

  return {
    bookings: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
  };
}

export async function reassignBooking(
  bookingId: number,
  providerId: number,
  force = false,
) {
  return await authFetch(
    `/api/admin/mechanics/bookings/${bookingId}/reassign`,
    {
      method: "POST",
      body: JSON.stringify({ providerId, force }),
    },
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/hmls-web && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/hmls-web/hooks/useAdminMechanics.ts
git commit -m "feat(web): admin mechanics data hooks"
```

---

## Task 7: Frontend — `UtilizationBar` + `MechanicCard` components

**Files:**
- Create: `apps/hmls-web/components/admin/mechanics/UtilizationBar.tsx`
- Create: `apps/hmls-web/components/admin/mechanics/MechanicCard.tsx`

- [ ] **Step 1: Create `UtilizationBar.tsx`**

```tsx
import { cn } from "@/lib/utils";

interface Props {
  percent: number | null;
  className?: string;
}

function colorClasses(percent: number): string {
  if (percent < 40) return "bg-muted-foreground/40";
  if (percent < 80) return "bg-green-500";
  if (percent < 95) return "bg-amber-500";
  return "bg-red-500";
}

export function UtilizationBar({ percent, className }: Props) {
  if (percent == null) {
    return (
      <div className={cn("flex items-center gap-2 text-xs", className)}>
        <div className="h-2 flex-1 rounded-full bg-muted" />
        <span className="text-muted-foreground">No hours set</span>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(percent, 100));
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full", colorClasses(percent))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="font-medium tabular-nums text-foreground w-10 text-right">
        {percent}%
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create `MechanicCard.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCents, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MechanicListRow } from "@/hooks/useAdminMechanics";
import { UtilizationBar } from "./UtilizationBar";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface Props {
  mechanic: MechanicListRow;
  onToggleActive: (m: MechanicListRow) => Promise<void>;
}

export function MechanicCard({ mechanic: m, onToggleActive }: Props) {
  const [isToggling, setIsToggling] = useState(false);

  const dotClass = m.isOnJobNow
    ? "bg-purple-500"
    : m.isActive
    ? "bg-green-500"
    : "bg-neutral-400";
  const dotLabel = m.isOnJobNow
    ? "On a job now"
    : m.isActive
    ? "Active"
    : "Inactive";

  async function handleToggle() {
    setIsToggling(true);
    try {
      await onToggleActive(m);
    } finally {
      setIsToggling(false);
    }
  }

  return (
    <Card className="p-0">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="size-10 shrink-0 rounded-full bg-red-500/10 text-red-600 dark:bg-red-900/30 dark:text-red-400 flex items-center justify-center text-sm font-semibold">
            {initials(m.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-foreground truncate">
                {m.name}
              </p>
              <span
                className={cn("size-2 rounded-full shrink-0", dotClass)}
                aria-label={dotLabel}
                title={dotLabel}
              />
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {m.email ?? "No email"} · {m.phone ?? "No phone"}
            </p>
          </div>
        </div>

        <UtilizationBar percent={m.weekUtilization} />

        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>
            <span className="font-medium text-foreground">Next:</span>{" "}
            {m.nextBookingAt ? formatDateTime(m.nextBookingAt) : "No upcoming bookings"}
          </p>
          <p>
            <span className="font-medium text-foreground">Upcoming:</span>{" "}
            {m.upcomingBookingsCount} job
            {m.upcomingBookingsCount === 1 ? "" : "s"} this week
          </p>
          <p>
            <span className="font-medium text-foreground">Earnings (30d):</span>{" "}
            {formatCents(m.earnings30d)}
          </p>
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggle}
            disabled={isToggling}
          >
            {m.isActive ? "Deactivate" : "Reactivate"}
          </Button>
          <Link
            href={`/admin/mechanics/${m.id}`}
            className="text-sm text-primary font-medium hover:text-primary/80"
          >
            View →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/hmls-web && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/hmls-web/components/admin/mechanics/UtilizationBar.tsx apps/hmls-web/components/admin/mechanics/MechanicCard.tsx
git commit -m "feat(web): mechanic card + utilization bar components"
```

---

## Task 8: Frontend — Fleet board page + KPI strip + empty/loading

**Files:**
- Create: `apps/hmls-web/app/(admin)/admin/mechanics/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import {
  type MechanicListRow,
  useAdminMechanics,
} from "@/hooks/useAdminMechanics";
import { MechanicCard } from "@/components/admin/mechanics/MechanicCard";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { AddMechanicDialog } from "@/components/admin/mechanics/AddMechanicDialog";

type Filter = "all" | "active" | "inactive" | "available-today";

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4 gap-0">
      <CardContent className="p-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-display font-bold text-foreground tabular-nums">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-medium border transition",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

export default function MechanicsPage() {
  const { mechanics, isLoading, mutate } = useAdminMechanics();
  const [filter, setFilter] = useState<Filter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "all") return mechanics;
    if (filter === "active") return mechanics.filter((m) => m.isActive);
    if (filter === "inactive") return mechanics.filter((m) => !m.isActive);
    // "available-today" = active + has any availability (weekUtilization not null)
    return mechanics.filter(
      (m) => m.isActive && m.weekUtilization !== null,
    );
  }, [mechanics, filter]);

  const stats = useMemo(() => {
    const active = mechanics.filter((m) => m.isActive);
    const utilValues = mechanics
      .map((m) => m.weekUtilization)
      .filter((u): u is number => u != null);
    const avg = utilValues.length
      ? Math.round(
        utilValues.reduce((a, b) => a + b, 0) / utilValues.length,
      )
      : null;
    const bookingsThisWeek = mechanics.reduce(
      (acc, m) => acc + m.upcomingBookingsCount,
      0,
    );
    return {
      total: mechanics.length,
      active: active.length,
      avg,
      bookingsThisWeek,
    };
  }, [mechanics]);

  async function toggleActive(m: MechanicListRow) {
    const { authFetch } = await import("@/lib/fetcher");
    if (m.isActive) {
      await authFetch(`/api/admin/mechanics/${m.id}`, { method: "DELETE" });
    } else {
      await authFetch(`/api/admin/mechanics/${m.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      });
    }
    await mutate();
  }

  if (isLoading) {
    return (
      <div>
        <Skeleton className="h-8 w-40 mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {["k1", "k2", "k3", "k4"].map((k) => (
            <Skeleton key={k} className="h-20 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {["m1", "m2", "m3"].map((k) => (
            <Skeleton key={k} className="h-60 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-foreground">
          Mechanics
        </h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" /> Add Mechanic
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile label="Total" value={String(stats.total)} />
        <KpiTile label="Active" value={String(stats.active)} />
        <KpiTile
          label="Avg utilization"
          value={stats.avg == null ? "—" : `${stats.avg}%`}
        />
        <KpiTile
          label="Bookings (week)"
          value={String(stats.bookingsThisWeek)}
        />
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </FilterChip>
        <FilterChip
          active={filter === "active"}
          onClick={() => setFilter("active")}
        >
          Active
        </FilterChip>
        <FilterChip
          active={filter === "inactive"}
          onClick={() => setFilter("inactive")}
        >
          Inactive
        </FilterChip>
        <FilterChip
          active={filter === "available-today"}
          onClick={() => setFilter("available-today")}
        >
          Available today
        </FilterChip>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6 text-center">
          <CardContent className="p-0">
            <p className="text-sm text-muted-foreground">
              {mechanics.length === 0
                ? "No mechanics yet. Add your first to get started."
                : "No mechanics match this filter."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((m) => (
            <MechanicCard
              key={m.id}
              mechanic={m}
              onToggleActive={toggleActive}
            />
          ))}
        </div>
      )}

      <AddMechanicDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => mutate()}
      />
    </div>
  );
}
```

Note: `AddMechanicDialog` is created in Task 9 — this import is resolved there.

- [ ] **Step 2: Commit (do not typecheck yet — `AddMechanicDialog` file is missing until Task 9)**

```bash
git add apps/hmls-web/app/\(admin\)/admin/mechanics/page.tsx
git commit -m "feat(web): admin mechanics fleet board page"
```

---

## Task 9: Frontend — Add Mechanic Dialog

**Files:**
- Create: `apps/hmls-web/components/admin/mechanics/AddMechanicDialog.tsx`

- [ ] **Step 1: Create the dialog**

```tsx
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminMechanics } from "@/hooks/useAdminMechanics";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function AddMechanicDialog({ open, onOpenChange, onCreated }: Props) {
  const { createMechanic } = useAdminMechanics();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [radius, setRadius] = useState("30");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [specialties, setSpecialties] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setEmail("");
    setPhone("");
    setTimezone("America/Los_Angeles");
    setRadius("30");
    setLat("");
    setLng("");
    setSpecialties("");
    setError(null);
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createMechanic({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        timezone: timezone.trim() || undefined,
        serviceRadiusMiles: radius ? Number(radius) : undefined,
        homeBaseLat: lat ? Number(lat) : undefined,
        homeBaseLng: lng ? Number(lng) : undefined,
        specialties: specialties
          ? specialties
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
          : undefined,
      });
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create mechanic");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Mechanic</DialogTitle>
          <DialogDescription>
            Create a mechanic record. Link them to a Supabase user later to
            grant login access.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="m-name">Name *</Label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="m-email">Email</Label>
              <Input
                id="m-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-phone">Phone</Label>
              <Input
                id="m-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="m-tz">Timezone</Label>
              <Input
                id="m-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-radius">Service radius (miles)</Label>
              <Input
                id="m-radius"
                type="number"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="m-lat">Home base latitude</Label>
              <Input
                id="m-lat"
                type="number"
                step="0.0000001"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-lng">Home base longitude</Label>
              <Input
                id="m-lng"
                type="number"
                step="0.0000001"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="m-spec">Specialties (comma-separated)</Label>
            <Input
              id="m-spec"
              value={specialties}
              onChange={(e) => setSpecialties(e.target.value)}
              placeholder="e.g. Brakes, Diagnostics"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create mechanic"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/hmls-web && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Add nav entry and commit**

Edit `apps/hmls-web/app/(admin)/admin/layout.tsx`. Update the imports line to include `Wrench`:

```tsx
import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  MessageSquare,
  Users,
  Wrench,
} from "lucide-react";
```

Change the `navItems` array to:

```tsx
const navItems: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList },
  { href: "/admin/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/admin/mechanics", label: "Mechanics", icon: Wrench },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/chat", label: "Chat", icon: MessageSquare },
];
```

Commit:

```bash
git add apps/hmls-web/components/admin/mechanics/AddMechanicDialog.tsx apps/hmls-web/app/\(admin\)/admin/layout.tsx
git commit -m "feat(web): add mechanic dialog + nav entry"
```

---

## Task 10: Frontend — Mechanic detail page (profile + bookings)

**Files:**
- Create: `apps/hmls-web/components/admin/mechanics/EditProfileForm.tsx`
- Create: `apps/hmls-web/app/(admin)/admin/mechanics/[id]/page.tsx`

- [ ] **Step 1: Create `EditProfileForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Mechanic } from "@/hooks/useAdminMechanics";

interface Props {
  mechanic: Mechanic;
  onSave: (patch: Partial<Mechanic>) => Promise<void>;
  onCancel: () => void;
}

export function EditProfileForm({ mechanic, onSave, onCancel }: Props) {
  const [name, setName] = useState(mechanic.name);
  const [email, setEmail] = useState(mechanic.email ?? "");
  const [phone, setPhone] = useState(mechanic.phone ?? "");
  const [timezone, setTimezone] = useState(mechanic.timezone);
  const [radius, setRadius] = useState(
    String(mechanic.serviceRadiusMiles ?? ""),
  );
  const [lat, setLat] = useState(mechanic.homeBaseLat ?? "");
  const [lng, setLng] = useState(mechanic.homeBaseLng ?? "");
  const [specialties, setSpecialties] = useState(
    Array.isArray(mechanic.specialties)
      ? (mechanic.specialties as string[]).join(", ")
      : "",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        timezone: timezone.trim(),
        serviceRadiusMiles: radius ? Number(radius) : null,
        homeBaseLat: lat || null,
        homeBaseLng: lng || null,
        specialties: specialties
          ? specialties.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="ep-name">Name</Label>
        <Input
          id="ep-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="ep-email">Email</Label>
          <Input
            id="ep-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ep-phone">Phone</Label>
          <Input
            id="ep-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="ep-tz">Timezone</Label>
          <Input
            id="ep-tz"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ep-radius">Service radius (miles)</Label>
          <Input
            id="ep-radius"
            type="number"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="ep-lat">Home base lat</Label>
          <Input
            id="ep-lat"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ep-lng">Home base lng</Label>
          <Input
            id="ep-lng"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ep-spec">Specialties (comma-separated)</Label>
        <Input
          id="ep-spec"
          value={specialties}
          onChange={(e) => setSpecialties(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the detail page with profile + bookings list**

Create `apps/hmls-web/app/(admin)/admin/mechanics/[id]/page.tsx`:

```tsx
"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type MechanicBookingRow,
  useAdminMechanic,
  useAdminMechanicBookings,
} from "@/hooks/useAdminMechanics";
import { EditProfileForm } from "@/components/admin/mechanics/EditProfileForm";
import { formatDateTime } from "@/lib/format";
import { BOOKING_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

function ProfileCard({ id }: { id: number }) {
  const { mechanic, updateMechanic, deactivate } = useAdminMechanic(id);
  const [editing, setEditing] = useState(false);

  if (!mechanic) return <Skeleton className="h-40 w-full" />;

  const specialtiesList = Array.isArray(mechanic.specialties)
    ? (mechanic.specialties as string[])
    : [];

  return (
    <Card className="p-4 gap-0">
      <CardContent className="p-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Profile</h2>
          {!editing && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              {mechanic.isActive && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deactivate()}
                >
                  Deactivate
                </Button>
              )}
              {!mechanic.isActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateMechanic({ isActive: true })}
                >
                  Reactivate
                </Button>
              )}
            </div>
          )}
        </div>

        {editing
          ? (
            <EditProfileForm
              mechanic={mechanic}
              onCancel={() => setEditing(false)}
              onSave={async (patch) => {
                await updateMechanic(patch);
                setEditing(false);
              }}
            />
          )
          : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{mechanic.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="text-foreground">{mechanic.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">Timezone</dt>
              <dd className="text-foreground">{mechanic.timezone}</dd>
              <dt className="text-muted-foreground">Service radius</dt>
              <dd className="text-foreground">
                {mechanic.serviceRadiusMiles ?? "—"} miles
              </dd>
              <dt className="text-muted-foreground">Home base</dt>
              <dd className="text-foreground">
                {mechanic.homeBaseLat && mechanic.homeBaseLng
                  ? `${mechanic.homeBaseLat}, ${mechanic.homeBaseLng}`
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">Specialties</dt>
              <dd className="text-foreground">
                {specialtiesList.length > 0
                  ? specialtiesList.join(", ")
                  : "—"}
              </dd>
            </dl>
          )}
      </CardContent>
    </Card>
  );
}

function BookingRow({
  b,
  onReassign,
}: {
  b: MechanicBookingRow;
  onReassign: (b: MechanicBookingRow) => void;
}) {
  const statusCfg = BOOKING_STATUS[b.status];
  return (
    <div className="flex items-start gap-3 px-3 py-2 border-b border-border last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">
            {formatDateTime(b.scheduledAt)}
          </p>
          {statusCfg && (
            <Badge className={cn("border-transparent", statusCfg.color)}>
              {statusCfg.label}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {b.serviceType} · {b.customer.name ?? "Customer"}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Booking actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onReassign(b)}>
            Reassign…
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/admin/orders?bookingId=${b.id}`}>Open order</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function MechanicDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const id = Number(idStr);
  const { mechanic, isLoading } = useAdminMechanic(id);
  const { bookings, mutate: mutateBookings } = useAdminMechanicBookings(
    id,
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  );
  const [reassignTarget, setReassignTarget] = useState<
    MechanicBookingRow | null
  >(null);

  if (isLoading || !mechanic) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  const upcoming = bookings.filter(
    (b) => new Date(b.scheduledAt) >= new Date(),
  );
  const recentCompleted = bookings
    .filter((b) => b.status === "completed")
    .slice(-10)
    .reverse();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/mechanics"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-2xl font-display font-bold text-foreground">
          {mechanic.name}
        </h1>
        <span
          className={cn(
            "size-2 rounded-full",
            mechanic.isActive ? "bg-green-500" : "bg-neutral-400",
          )}
        />
      </div>

      <ProfileCard id={id} />

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2">
          Upcoming bookings
        </h2>
        <Card className="p-0">
          <CardContent className="p-0">
            {upcoming.length === 0
              ? (
                <p className="text-sm text-muted-foreground p-4">
                  No upcoming bookings.
                </p>
              )
              : (
                upcoming
                  .slice(0, 20)
                  .map((b) => (
                    <BookingRow
                      key={b.id}
                      b={b}
                      onReassign={setReassignTarget}
                    />
                  ))
              )}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2">
          Recent completed
        </h2>
        <Card className="p-0">
          <CardContent className="p-0">
            {recentCompleted.length === 0
              ? (
                <p className="text-sm text-muted-foreground p-4">
                  No completed jobs yet.
                </p>
              )
              : (
                recentCompleted.map((b) => (
                  <BookingRow
                    key={b.id}
                    b={b}
                    onReassign={setReassignTarget}
                  />
                ))
              )}
          </CardContent>
        </Card>
      </div>

      {/* ReassignBookingDialog is wired in Task 13 */}
      {reassignTarget && (
        <div className="text-xs text-muted-foreground">
          Reassign dialog coming in next task for booking #{reassignTarget.id};
          close:{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setReassignTarget(null)}
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/hmls-web && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/hmls-web/app/\(admin\)/admin/mechanics/\[id\]/page.tsx apps/hmls-web/components/admin/mechanics/EditProfileForm.tsx
git commit -m "feat(web): mechanic detail page - profile + bookings"
```

---

## Task 11: Frontend — 7-day schedule strip component

**Files:**
- Create: `apps/hmls-web/components/admin/mechanics/ScheduleStrip.tsx`

This renders today + 6 days, with availability background + booking blocks overlaid.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useMemo } from "react";
import type { Booking } from "@/lib/types";
import type {
  ScheduleOverride,
  WeeklyRow,
} from "@/hooks/useAdminMechanics";
import { cn } from "@/lib/utils";

interface Props {
  weekly: WeeklyRow[];
  overrides: ScheduleOverride[];
  bookings: Booking[];
  /** Inclusive — first day of strip. Defaults to today. */
  startDate?: Date;
}

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 20;
const TOTAL_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

function toMin(hm: string) {
  const [h, m] = hm.split(":");
  return Number(h) * 60 + Number(m);
}

function minutesToHM(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function bookingColor(status: string): string {
  switch (status) {
    case "confirmed":
      return "bg-blue-500";
    case "requested":
      return "bg-amber-500";
    case "completed":
      return "bg-green-500";
    case "rejected":
    case "cancelled":
      return "bg-neutral-400";
    default:
      return "bg-purple-500";
  }
}

export function ScheduleStrip(
  { weekly, overrides, bookings, startDate }: Props,
) {
  const days = useMemo(() => {
    const start = startDate ?? new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [startDate]);

  const weeklyByDow = useMemo(() => {
    const m = new Map<number, WeeklyRow[]>();
    for (const w of weekly) {
      const list = m.get(w.dayOfWeek) ?? [];
      list.push(w);
      m.set(w.dayOfWeek, list);
    }
    return m;
  }, [weekly]);

  const overrideByDate = useMemo(() => {
    const m = new Map<string, ScheduleOverride>();
    for (const o of overrides) m.set(o.overrideDate, o);
    return m;
  }, [overrides]);

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const dateKey = day.toISOString().slice(0, 10);
        const dow = day.getDay();
        const override = overrideByDate.get(dateKey);

        // Compute available ranges for this day.
        let availableRanges: Array<{ startMin: number; endMin: number }> = [];
        if (override) {
          if (override.isAvailable && override.startTime && override.endTime) {
            availableRanges = [
              {
                startMin: toMin(override.startTime),
                endMin: toMin(override.endTime),
              },
            ];
          }
        } else {
          availableRanges = (weeklyByDow.get(dow) ?? []).map((w) => ({
            startMin: toMin(w.startTime),
            endMin: toMin(w.endTime),
          }));
        }

        const dayStart = DAY_START_HOUR * 60;
        const dayEnd = DAY_END_HOUR * 60;

        const dayBookings = bookings.filter((b) => {
          const d = new Date(b.scheduledAt);
          return d.toISOString().slice(0, 10) === dateKey;
        });

        return (
          <div key={dateKey} className="flex flex-col">
            <div className="text-xs font-medium text-muted-foreground text-center mb-1">
              {day.toLocaleDateString("en-US", {
                weekday: "short",
                month: "numeric",
                day: "numeric",
              })}
            </div>
            <div className="relative h-56 rounded-md bg-muted overflow-hidden border border-border">
              {/* Available shading */}
              {availableRanges.map((r, i) => {
                const top = ((Math.max(r.startMin, dayStart) - dayStart) /
                  TOTAL_MINUTES) * 100;
                const height =
                  ((Math.min(r.endMin, dayEnd) - Math.max(r.startMin, dayStart)) /
                    TOTAL_MINUTES) * 100;
                if (height <= 0) return null;
                return (
                  <div
                    key={i}
                    className="absolute left-0 right-0 bg-green-100 dark:bg-green-900/20"
                    style={{ top: `${top}%`, height: `${height}%` }}
                  />
                );
              })}

              {/* Booking blocks */}
              {dayBookings.map((b) => {
                const d = new Date(b.scheduledAt);
                const startMin = d.getHours() * 60 + d.getMinutes();
                const endMin = startMin + b.durationMinutes;
                const top = ((Math.max(startMin, dayStart) - dayStart) /
                  TOTAL_MINUTES) * 100;
                const height = ((Math.min(endMin, dayEnd) -
                  Math.max(startMin, dayStart)) / TOTAL_MINUTES) * 100;
                if (height <= 0) return null;
                return (
                  <div
                    key={b.id}
                    className={cn(
                      "absolute left-1 right-1 rounded px-1 text-[10px] text-white font-medium truncate",
                      bookingColor(b.status),
                    )}
                    style={{ top: `${top}%`, height: `${height}%` }}
                    title={`${minutesToHM(startMin)} ${b.serviceType}`}
                  >
                    {minutesToHM(startMin)} {b.serviceType}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the detail page**

Edit `apps/hmls-web/app/(admin)/admin/mechanics/[id]/page.tsx`. Add these imports at the top:

```tsx
import {
  useAdminMechanicAvailability,
  useAdminMechanicOverrides,
} from "@/hooks/useAdminMechanics";
import { ScheduleStrip } from "@/components/admin/mechanics/ScheduleStrip";
```

Inside `MechanicDetailPage`, after the existing `useAdminMechanicBookings` hook call, add:

```tsx
  const { availability } = useAdminMechanicAvailability(id);
  const { overrides } = useAdminMechanicOverrides(
    id,
    new Date().toISOString().slice(0, 10),
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
```

Insert a new section between `<ProfileCard />` and "Upcoming bookings":

```tsx
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground">
            Next 7 days
          </h2>
          {/* Edit hours / Add time off buttons — wired in Task 12 */}
        </div>
        <Card className="p-3">
          <CardContent className="p-0">
            <ScheduleStrip
              weekly={availability}
              overrides={overrides}
              bookings={bookings}
            />
          </CardContent>
        </Card>
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/hmls-web && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/hmls-web/components/admin/mechanics/ScheduleStrip.tsx apps/hmls-web/app/\(admin\)/admin/mechanics/\[id\]/page.tsx
git commit -m "feat(web): 7-day schedule strip on mechanic detail"
```

---

## Task 12: Frontend — Edit Hours + Add Time Off dialogs

**Files:**
- Create: `apps/hmls-web/components/admin/mechanics/EditHoursDialog.tsx`
- Create: `apps/hmls-web/components/admin/mechanics/AddTimeOffDialog.tsx`
- Modify: `apps/hmls-web/app/(admin)/admin/mechanics/[id]/page.tsx`

- [ ] **Step 1: Create `EditHoursDialog.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAdminMechanicAvailability } from "@/hooks/useAdminMechanics";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Slot {
  dayOfWeek: number;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

function normalize(t: string) {
  return t.length >= 5 ? t.slice(0, 5) : t;
}

interface Props {
  mechanicId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditHoursDialog({ mechanicId, open, onOpenChange }: Props) {
  const { availability, saveAvailability } =
    useAdminMechanicAvailability(mechanicId);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSlots(
        availability.map((a) => ({
          dayOfWeek: a.dayOfWeek,
          startTime: normalize(a.startTime),
          endTime: normalize(a.endTime),
        })),
      );
      setError(null);
    }
  }, [open, availability]);

  function update(idx: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }

  function remove(idx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    for (const s of slots) {
      if (s.endTime <= s.startTime) {
        setError("End time must be after start time");
        return;
      }
    }
    setIsSaving(true);
    setError(null);
    try {
      await saveAvailability(
        slots.map((s) => ({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime.length === 5 ? `${s.startTime}:00` : s.startTime,
          endTime: s.endTime.length === 5 ? `${s.endTime}:00` : s.endTime,
        })),
      );
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Weekly hours</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {slots.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hours set. Add a time range to start.
            </p>
          )}
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={s.dayOfWeek}
                onChange={(e) =>
                  update(i, { dayOfWeek: Number(e.target.value) })}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-background"
              >
                {DAY_LABELS.map((label, idx) => (
                  <option key={label} value={idx}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={s.startTime}
                onChange={(e) => update(i, { startTime: e.target.value })}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-background"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <input
                type="time"
                value={s.endTime}
                onChange={(e) => update(i, { endTime: e.target.value })}
                className="border border-border rounded-md px-2 py-1.5 text-sm bg-background"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(i)}
                className="text-muted-foreground hover:text-red-500"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setSlots((prev) => [
                ...prev,
                { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
              ])}
          >
            + Add time range
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `AddTimeOffDialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminMechanicOverrides } from "@/hooks/useAdminMechanics";

interface Props {
  mechanicId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddTimeOffDialog({ mechanicId, open, onOpenChange }: Props) {
  const { addOverride } = useAdminMechanicOverrides(mechanicId);
  const [date, setDate] = useState("");
  const [isAvailable, setIsAvailable] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    if (!date) {
      setError("Date is required");
      return;
    }
    if (isAvailable && (!startTime || !endTime)) {
      setError("Provide start and end time for extra-hours");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await addOverride({
        overrideDate: date,
        isAvailable,
        startTime: isAvailable
          ? (startTime.length === 5 ? `${startTime}:00` : startTime)
          : undefined,
        endTime: isAvailable
          ? (endTime.length === 5 ? `${endTime}:00` : endTime)
          : undefined,
        reason: reason.trim() || undefined,
      });
      setDate("");
      setStartTime("");
      setEndTime("");
      setReason("");
      setIsAvailable(false);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add schedule override</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="to-date">Date</Label>
            <Input
              id="to-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isAvailable}
              onChange={(e) => setIsAvailable(e.target.checked)}
            />
            Extra hours (vs. full-day time off)
          </label>
          {isAvailable && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="to-start">Start</Label>
                <Input
                  id="to-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to-end">End</Label>
                <Input
                  id="to-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="to-reason">Reason (optional)</Label>
            <Input
              id="to-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire into detail page**

Edit `apps/hmls-web/app/(admin)/admin/mechanics/[id]/page.tsx`. Add imports:

```tsx
import { EditHoursDialog } from "@/components/admin/mechanics/EditHoursDialog";
import { AddTimeOffDialog } from "@/components/admin/mechanics/AddTimeOffDialog";
```

Inside the component, add state near the top:

```tsx
  const [editHoursOpen, setEditHoursOpen] = useState(false);
  const [timeOffOpen, setTimeOffOpen] = useState(false);
```

Replace the placeholder comment `{/* Edit hours / Add time off buttons — wired in Task 12 */}` with:

```tsx
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditHoursOpen(true)}
            >
              Edit hours
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTimeOffOpen(true)}
            >
              Add time off
            </Button>
          </div>
```

At the bottom of the returned JSX, before the closing `</div>`, add:

```tsx
      <EditHoursDialog
        mechanicId={id}
        open={editHoursOpen}
        onOpenChange={setEditHoursOpen}
      />
      <AddTimeOffDialog
        mechanicId={id}
        open={timeOffOpen}
        onOpenChange={setTimeOffOpen}
      />
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/hmls-web && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hmls-web/components/admin/mechanics/EditHoursDialog.tsx apps/hmls-web/components/admin/mechanics/AddTimeOffDialog.tsx apps/hmls-web/app/\(admin\)/admin/mechanics/\[id\]/page.tsx
git commit -m "feat(web): edit hours + time off dialogs"
```

---

## Task 13: Frontend — Reassign Booking dialog + wire into detail page

**Files:**
- Create: `apps/hmls-web/components/admin/mechanics/ReassignBookingDialog.tsx`
- Modify: `apps/hmls-web/app/(admin)/admin/mechanics/[id]/page.tsx`

- [ ] **Step 1: Create the dialog**

```tsx
"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  reassignBooking,
  useAdminMechanics,
} from "@/hooks/useAdminMechanics";
import { formatDateTime } from "@/lib/format";
import type { Booking } from "@/lib/types";

interface Props {
  booking: Booking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReassigned?: () => void;
}

export function ReassignBookingDialog(
  { booking, open, onOpenChange, onReassigned }: Props,
) {
  const { mechanics } = useAdminMechanics();
  const [targetId, setTargetId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const bookingStart = booking ? new Date(booking.scheduledAt) : null;
  const bookingEnd = booking && bookingStart
    ? new Date(bookingStart.getTime() + booking.durationMinutes * 60_000)
    : null;

  const candidates = useMemo(() => {
    return mechanics
      .filter((m) => m.isActive && m.id !== booking?.providerId)
      .map((m) => {
        // "Busy" heuristic: mechanic has isOnJobNow true and the booking is now-ish.
        const busy = m.isOnJobNow && bookingStart != null && bookingEnd != null &&
          bookingStart.getTime() <= Date.now() &&
          Date.now() < bookingEnd.getTime();
        return { ...m, busy };
      });
  }, [mechanics, booking, bookingStart, bookingEnd]);

  const warn = targetId != null &&
    candidates.find((c) => c.id === targetId)?.busy;

  async function handleConfirm() {
    if (!booking || targetId == null) return;
    setIsSaving(true);
    setError(null);
    try {
      await reassignBooking(booking.id, targetId, !!warn);
      setTargetId(null);
      onOpenChange(false);
      onReassigned?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reassign");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign booking</DialogTitle>
          {booking && (
            <DialogDescription>
              #{booking.id} · {formatDateTime(booking.scheduledAt)} ·{" "}
              {booking.serviceType}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3">
          <select
            value={targetId ?? ""}
            onChange={(e) =>
              setTargetId(e.target.value ? Number(e.target.value) : null)}
            className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background"
          >
            <option value="">Select a mechanic…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.busy ? " (busy now)" : ""}
              </option>
            ))}
          </select>
          {warn && (
            <p className="text-xs text-amber-600">
              Heads up — this mechanic appears busy. Confirming will still reassign.
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSaving || targetId == null}
          >
            {isSaving ? "Reassigning..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire into detail page**

Edit `apps/hmls-web/app/(admin)/admin/mechanics/[id]/page.tsx`. Add import:

```tsx
import { ReassignBookingDialog } from "@/components/admin/mechanics/ReassignBookingDialog";
```

Replace the placeholder block `{reassignTarget && (...dismiss...)}` with:

```tsx
      <ReassignBookingDialog
        booking={reassignTarget}
        open={!!reassignTarget}
        onOpenChange={(o) => !o && setReassignTarget(null)}
        onReassigned={() => {
          mutateBookings();
          setReassignTarget(null);
        }}
      />
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/hmls-web && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/hmls-web/components/admin/mechanics/ReassignBookingDialog.tsx apps/hmls-web/app/\(admin\)/admin/mechanics/\[id\]/page.tsx
git commit -m "feat(web): reassign booking dialog"
```

---

## Task 14: Frontend — expose Reassign from admin order detail

**Files:**
- Modify: `apps/hmls-web/app/(admin)/admin/orders/[id]/page.tsx`

**Context:** The spec says reassign should be discoverable from admin order pages too. This is a light wiring task — add a single button that opens the existing dialog when the order has a linked booking.

- [ ] **Step 1: Read the file to find the right spot**

Run: Open `apps/hmls-web/app/(admin)/admin/orders/[id]/page.tsx`. Locate where the order + booking are rendered (the page uses `useAdminOrder` and has a `booking` field).

- [ ] **Step 2: Add the dialog import + button**

At the top of the file, add:

```tsx
import { useState } from "react";
import { ReassignBookingDialog } from "@/components/admin/mechanics/ReassignBookingDialog";
```

Inside the component, near the other state, add:

```tsx
  const [reassignOpen, setReassignOpen] = useState(false);
```

In the booking section (wherever the booking details are rendered — search for `booking` object usage), add a button next to existing actions:

```tsx
{data?.booking && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => setReassignOpen(true)}
  >
    Reassign mechanic
  </Button>
)}
```

At the end of the returned JSX, before the final closing tag, add:

```tsx
{data?.booking && (
  <ReassignBookingDialog
    booking={data.booking}
    open={reassignOpen}
    onOpenChange={setReassignOpen}
    onReassigned={() => mutate()}
  />
)}
```

If `mutate` is not already in scope from `useAdminOrder(...)`, change the destructure to include it:

```tsx
const { data, isLoading, mutate } = useAdminOrder(id);
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/hmls-web && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/hmls-web/app/\(admin\)/admin/orders/\[id\]/page.tsx
git commit -m "feat(web): reassign mechanic button on admin order detail"
```

---

## Task 15: KPI tiles on mechanic detail page

**Files:**
- Modify: `apps/hmls-web/app/(admin)/admin/mechanics/[id]/page.tsx`

**What this covers:** Spec calls for a right-sidebar KPI block on the detail page (Week utilization · Bookings this week · Earnings 30d · Jobs completed). The `GET /admin/mechanics/:id` endpoint returns plain profile only; the aggregate stats already live on the list endpoint, so we re-read the fleet list with SWR (cached) and pluck this mechanic's row. No new backend endpoint needed. Jobs-completed comes from the bookings list we already load (filter `status = 'completed'`).

The sparkline from the spec is deliberately out-of-scope for this plan — it would need an 8-week historical utilization endpoint. Noted in spec's "Out-of-scope follow-ups".

- [ ] **Step 1: Extend the detail page**

Edit `apps/hmls-web/app/(admin)/admin/mechanics/[id]/page.tsx`. Add the hook import at the top if not already imported:

```tsx
import { useAdminMechanics } from "@/hooks/useAdminMechanics";
```

Add `formatCents` import:

```tsx
import { formatCents } from "@/lib/format";
```

Inside `MechanicDetailPage`, after the existing hook calls, add:

```tsx
  const { mechanics } = useAdminMechanics();
  const listRow = mechanics.find((m) => m.id === id);
  const jobsCompleted = bookings.filter((b) => b.status === "completed").length;
```

Insert this block immediately under the header, before `<ProfileCard />`:

```tsx
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 gap-0">
          <CardContent className="p-0">
            <p className="text-xs text-muted-foreground">Week utilization</p>
            <p className="text-lg font-display font-bold text-foreground tabular-nums">
              {listRow?.weekUtilization == null
                ? "—"
                : `${listRow.weekUtilization}%`}
            </p>
          </CardContent>
        </Card>
        <Card className="p-4 gap-0">
          <CardContent className="p-0">
            <p className="text-xs text-muted-foreground">Bookings this week</p>
            <p className="text-lg font-display font-bold text-foreground tabular-nums">
              {listRow?.upcomingBookingsCount ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="p-4 gap-0">
          <CardContent className="p-0">
            <p className="text-xs text-muted-foreground">Earnings (30d)</p>
            <p className="text-lg font-display font-bold text-foreground tabular-nums">
              {formatCents(listRow?.earnings30d ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="p-4 gap-0">
          <CardContent className="p-0">
            <p className="text-xs text-muted-foreground">Jobs completed</p>
            <p className="text-lg font-display font-bold text-foreground tabular-nums">
              {jobsCompleted}
            </p>
          </CardContent>
        </Card>
      </div>
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/hmls-web && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/hmls-web/app/\(admin\)/admin/mechanics/\[id\]/page.tsx
git commit -m "feat(web): mechanic detail KPI tiles"
```

---

## Task 16: Full CI suite + manual QA

**Files:** none (verification only).

- [ ] **Step 1: Run full CI locally**

```bash
cd apps/hmls-web && bun run lint && bun run typecheck && bun run build
cd ../.. && deno task check && deno task lint
```

Expected: all pass. If anything fails, fix inline before continuing.

- [ ] **Step 2: Start dev servers and QA**

In one terminal:

```bash
deno task dev:api
```

In another:

```bash
cd apps/hmls-web && bun run dev
```

- [ ] **Step 3: Walk the golden path**

Sign in as an admin user (or set `SKIP_AUTH=true` for the API), then:

1. Navigate to `/admin/mechanics`. Expect fleet board with existing mechanics (if any) or empty state.
2. Click `+ Add Mechanic`. Fill name + phone + radius, submit. New card appears.
3. Click `View →` on the new card. Profile page opens.
4. Click `Edit`. Change phone. Save. Profile shows new phone.
5. Click `Edit hours`. Add a Monday 09:00–17:00 slot. Save. Schedule strip updates.
6. Click `Add time off`. Pick tomorrow's date (full-day time off). Save. Strip shows that day greyed.
7. If seed data has a booking assigned to another mechanic, open that mechanic's detail, click `Reassign…` on a booking, select the new mechanic. Verify booking moves.
8. Back on the fleet board, click `Deactivate` on a card. It moves to inactive filter.
9. Reactivate via the `Inactive` filter.
10. Navigate to `/admin/orders/<id>` for an order that has a booking. Verify `Reassign mechanic` button appears and works.

- [ ] **Step 4: Commit if any fixes were needed during QA**

```bash
git add -A
git commit -m "fix(admin-mechanics): QA findings"
```

(skip this step if nothing needed fixing)

- [ ] **Step 5: Push for PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: admin mechanics management" --body "$(cat <<'EOF'
## Summary
- Adds /admin/mechanics fleet board and per-mechanic detail page
- Backend: new /api/admin/mechanics router with list/CRUD, availability, overrides, bookings, and booking reassign endpoints
- No schema changes

## Test plan
- [x] Fleet board renders with KPI strip, filters, utilization bars
- [x] Create + edit + deactivate + reactivate mechanic
- [x] Edit weekly hours from admin side
- [x] Add time-off / extra-hours override
- [x] Reassign booking from mechanic detail and order detail
- [x] CI suite passes (bun typecheck, lint, build; deno check, lint)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
