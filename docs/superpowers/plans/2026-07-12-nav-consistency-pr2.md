# Nav Consistency PR-2 (flow fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the flows behind the nav: login returns you to where you were headed, portal 403s
are explicit, admin dashboard tiles link to what they count, and the redundant
`/portal/bookings` surface is deleted.

**Architecture:** A `lib/auth-redirect.ts` helper owns `?next=` validation (open-redirect guard)
and role home paths; guards append `next`, the login page and `/auth/callback` honor it.
`DashboardLayout` grows a `portalCheck` guard reusing the existing adminCheck plumbing. The admin
orders list gains two client-side virtual filters (`status=active`, `today=1`) that dashboard
tiles link to. Bookings page + hook + gateway routes are deleted.

**Tech Stack:** Next.js 16 App Router, Bun test, Hono gateway (Deno).

**Spec:** `docs/superpowers/specs/2026-07-12-nav-consistency-design.md` (PR-2 section).
**Depends on:** PR-1 landed (shared nav vocabulary in `lib/nav.ts`).

## Global Constraints

- `bun` for web, `deno task check` for gateway; Biome (web) / `deno fmt` (gateway, 100 cols).
- TypeScript strict everywhere; conventional commits.
- Web paths relative to `apps/hmls-web/`; gateway paths relative to repo root.
- Open-redirect guard is a trust boundary: `next` must be a same-origin relative path — reject
  anything not starting with exactly one `/` (no `//`, no `/\`), reject `/login` itself.
- Do NOT commit `.claude/launch.json`.

---

### Task 1: `lib/auth-redirect.ts` — next-param validation + role home

**Files:**
- Create: `lib/auth-redirect.ts`
- Test: `lib/auth-redirect.test.ts`

**Interfaces:**
- Produces: `safeNextPath(raw: string | null | undefined): string | null`;
  `roleHomePath(roles: { isAdmin: boolean; isMechanic: boolean }): string`.

- [ ] **Step 1: Write the failing test**

`lib/auth-redirect.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { roleHomePath, safeNextPath } from "./auth-redirect";

describe("safeNextPath", () => {
  test("accepts same-origin relative paths, with query strings", () => {
    expect(safeNextPath("/portal/orders")).toBe("/portal/orders");
    expect(safeNextPath("/admin/orders?status=active&today=1")).toBe(
      "/admin/orders?status=active&today=1",
    );
  });

  test("rejects absolute and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
  });

  test("rejects empty, missing, and login loops", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login?next=%2Fportal")).toBeNull();
  });
});

describe("roleHomePath", () => {
  test("routes staff to their sections, customers to chat", () => {
    expect(roleHomePath({ isAdmin: true, isMechanic: false })).toBe("/admin");
    expect(roleHomePath({ isAdmin: false, isMechanic: true })).toBe("/mechanic");
    expect(roleHomePath({ isAdmin: false, isMechanic: false })).toBe("/chat");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/hmls-web && bun test lib/auth-redirect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/auth-redirect.ts`:

```ts
/** Validate a ?next= value. Only same-origin relative paths survive —
 *  open-redirect guard. Returns null when the value must be ignored. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (raw === "/login" || raw.startsWith("/login?")) return null;
  return raw;
}

/** Where a user lands after login when no explicit destination was asked. */
export function roleHomePath(roles: {
  isAdmin: boolean;
  isMechanic: boolean;
}): string {
  if (roles.isAdmin) return "/admin";
  if (roles.isMechanic) return "/mechanic";
  return "/chat";
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/hmls-web && bun test lib/auth-redirect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hmls-web/lib/auth-redirect.ts apps/hmls-web/lib/auth-redirect.test.ts
git commit -m "feat(web): auth redirect helpers — validated next param + role home paths

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Guards carry `?next=`; login page and callback honor it

**Files:**
- Modify: `components/DashboardLayout.tsx` (login redirect)
- Modify: `app/(marketing)/chat/page.tsx:107-108` (login redirect)
- Modify: `app/(auth)/login/page.tsx` (redirect-on-session, OAuth redirectTo, signup
  emailRedirectTo, error-param cleanup)
- Modify: `app/auth/callback/route.ts` (validate next, preserve its query string)

**Interfaces:**
- Consumes (Task 1): `safeNextPath`, `roleHomePath`.

- [ ] **Step 1: DashboardLayout appends next**

In `components/DashboardLayout.tsx`, add `useSearchParams` to the next/navigation import, read it
next to `usePathname`, and change the guard effect:

```tsx
  const searchParams = useSearchParams();
```

```tsx
  useEffect(() => {
    if (!skipAuth && !authLoading && !session) {
      const qs = searchParams.toString();
      const next = qs ? `${pathname}?${qs}` : pathname;
      router.push(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [skipAuth, authLoading, session, router, pathname, searchParams]);
```

- [ ] **Step 2: Chat page guard appends next**

`app/(marketing)/chat/page.tsx` line ~108:

```tsx
      router.replace(`/login?next=${encodeURIComponent("/chat")}`);
```

- [ ] **Step 3: Login page honors next + role default**

In `app/(auth)/login/page.tsx`:

Imports: add `useSearchParams` to the next/navigation import and
`import { roleHomePath, safeNextPath } from "@/lib/auth-redirect";`.

Destructure roles: `const { supabase, session, isAdmin, isMechanic } = useAuth();` and
`const searchParams = useSearchParams();`.

Replace the session-redirect effect (lines 50-54):

```tsx
  useEffect(() => {
    if (!session) return;
    const next = safeNextPath(searchParams.get("next"));
    router.push(next ?? roleHomePath({ isAdmin, isMechanic }));
  }, [session, isAdmin, isMechanic, searchParams, router]);
```

Replace the error-cleanup effect (it currently wipes `next` by resetting the URL to `/login`):

```tsx
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackError = params.get("error");
    if (callbackError) {
      setError(callbackError);
      params.delete("error");
      const qs = params.toString();
      window.history.replaceState({}, "", qs ? `/login?${qs}` : "/login");
    }
  }, []);
```

Thread next through OAuth and signup so email/OAuth round-trips land right. Add inside the
component, above the handlers:

```tsx
  const nextParam = safeNextPath(searchParams.get("next"));
  const callbackUrl = () =>
    `${window.location.origin}/auth/callback${
      nextParam ? `?next=${encodeURIComponent(nextParam)}` : ""
    }`;
```

Then in `handleGoogleLogin`: `redirectTo: callbackUrl(),` and in the signup branch:
`emailRedirectTo: callbackUrl(),`.

- [ ] **Step 4: Callback route validates next and keeps its query**

Replace `app/auth/callback/route.ts` body (current version sets only `pathname`, which silently
drops any query inside next and does no validation):

```ts
import { type NextRequest, NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next")) ?? "/chat";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Customer record is auto-created/linked by DB trigger on auth.users INSERT
      return NextResponse.redirect(new URL(next, request.nextUrl.origin));
    }
  }

  // Auth failed — redirect to login with error
  const failure = new URL("/login", request.nextUrl.origin);
  failure.searchParams.set("error", "Could not authenticate");
  return NextResponse.redirect(failure);
}
```

- [ ] **Step 5: Gates**

Run: `cd apps/hmls-web && bun run typecheck && bun run lint && bun run test`
Expected: PASS. Note: `useSearchParams` in client components already under `"use client"` — no
Suspense boundary changes needed for DashboardLayout/chat (they're rendered inside layouts), but
if `bun run build` complains about `/login` needing a Suspense boundary, wrap the login page's
component per Next.js guidance and re-run.
Then: `infisical run --env=dev -- bun run build` — expected PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/hmls-web/components/DashboardLayout.tsx "apps/hmls-web/app/(marketing)/chat/page.tsx" \
  "apps/hmls-web/app/(auth)/login/page.tsx" apps/hmls-web/app/auth/callback/route.ts
git commit -m "feat(web): login honors ?next= with open-redirect guard; role-based default landing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Portal 403 → explicit denied state; hide portal link for mechanics

**Files:**
- Modify: `components/DashboardLayout.tsx` (add `portalCheck`)
- Modify: `app/(portal)/portal/layout.tsx` (pass `portalCheck`)
- Modify: `components/Navbar.tsx`, `components/MobileNav.tsx` (portal link gate)

**Interfaces:**
- Produces: `DashboardLayout` prop `portalCheck?: boolean` — guards via `GET /api/portal/me`,
  shows denied screen on 403 instead of letting pages render fake-empty success.

- [ ] **Step 1: DashboardLayout gains portalCheck**

Add the prop to the signature next to `adminCheck`/`mechanicCheck`:

```tsx
  adminCheck,
  mechanicCheck,
  portalCheck,
```
```tsx
  adminCheck?: boolean;
  mechanicCheck?: boolean;
  portalCheck?: boolean;
```

Extend the guard endpoint chain and loading/denied logic (replace the existing three spots):

```tsx
  const guardEndpoint = adminCheck
    ? "/api/admin/me"
    : mechanicCheck
      ? "/api/mechanic/me"
      : portalCheck
        ? "/api/portal/me"
        : null;
```

```tsx
  const isLoading =
    !skipAuth &&
    (authLoading ||
      ((adminCheck || mechanicCheck || portalCheck) && adminLoading));
```

```tsx
  if (!skipAuth && (adminCheck || mechanicCheck || portalCheck) && adminError) {
    const deniedMessage = adminCheck
      ? "You don't have admin access."
      : mechanicCheck
        ? "You don't have mechanic access."
        : "No customer account is linked to this login.";
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h1 className="text-lg font-display font-semibold text-foreground mb-1">
            Access Denied
          </h1>
          <p className="text-sm text-muted-foreground">{deniedMessage}</p>
        </div>
      </main>
    );
  }
```

- [ ] **Step 2: Portal layout adopts it**

`app/(portal)/portal/layout.tsx`:

```tsx
      <DashboardLayout navItems={portalNavItems} portalCheck>
        {children}
      </DashboardLayout>
```

- [ ] **Step 3: Hide the portal link for mechanics (both navs)**

Navbar (desktop block from PR-1 Task 3): change the gate to
`{isUserLoggedIn && !isMechanic && section !== "portal" && (` — mechanics have no customers row
by design; the link only bought them the new denied screen.
MobileNav: same `!isMechanic` addition on its portal-link gate.

- [ ] **Step 4: Gates + commit**

Run: `cd apps/hmls-web && bun run typecheck && bun run lint && bun run test`

```bash
git add apps/hmls-web/components/DashboardLayout.tsx "apps/hmls-web/app/(portal)/portal/layout.tsx" \
  apps/hmls-web/components/Navbar.tsx apps/hmls-web/components/MobileNav.tsx
git commit -m "fix(web): explicit portal denied state; hide portal link for mechanics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Admin orders virtual filters (`active`, `today=1`) + honest dashboard tiles

**Files:**
- Modify: `lib/admin-order-filters.ts`
- Test: `lib/admin-order-filters.test.ts` (extend)
- Modify: `app/(admin)/admin/orders/page.tsx` (parse + apply + Active chip + Today chip)
- Modify: `app/(admin)/admin/page.tsx` (tile hrefs, lines ~363-374 and ~392)

**Interfaces:**
- Produces: `AdminOrdersFilter` now includes `"active"`;
  `parseAdminOrdersToday(value: string | null | undefined): boolean`;
  `applyVirtualOrderFilters<T extends { status: string; scheduledAt: string | Date | null }>(rows: T[], filter: AdminOrdersFilter, today: boolean, now?: Date): T[]`;
  `getAdminOrdersListHref(filter, search?, opts?: { today?: boolean })`.
- Consumes: `canonicalStatus` from `lib/status-display`.

- [ ] **Step 1: Write the failing tests (extend `lib/admin-order-filters.test.ts`)**

```ts
import {
  applyVirtualOrderFilters,
  getAdminOrdersListHref,
  parseAdminOrdersFilter,
  parseAdminOrdersToday,
} from "./admin-order-filters";

// … existing tests stay …

describe("virtual filters", () => {
  const now = new Date("2026-07-12T15:00:00");
  const rows = [
    { id: 1, status: "approved", scheduledAt: "2026-07-12T09:00:00" },
    { id: 2, status: "approved", scheduledAt: "2026-07-13T09:00:00" },
    { id: 3, status: "in_progress", scheduledAt: null },
    { id: 4, status: "draft", scheduledAt: "2026-07-12T10:00:00" },
  ];

  test("'active' parses and unions approved + in_progress", () => {
    expect(parseAdminOrdersFilter("active")).toBe("active");
    expect(
      applyVirtualOrderFilters(rows, "active", false, now).map((r) => r.id),
    ).toEqual([1, 2, 3]);
  });

  test("today=1 keeps only rows scheduled within the local day", () => {
    expect(parseAdminOrdersToday("1")).toBe(true);
    expect(parseAdminOrdersToday(null)).toBe(false);
    expect(
      applyVirtualOrderFilters(rows, "active", true, now).map((r) => r.id),
    ).toEqual([1]);
  });

  test("plain status filters pass through untouched", () => {
    expect(applyVirtualOrderFilters(rows, "draft", false, now)).toHaveLength(4);
  });

  test("href builder carries today", () => {
    expect(getAdminOrdersListHref("active", undefined, { today: true })).toBe(
      "/admin/orders?status=active&today=1",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/hmls-web && bun test lib/admin-order-filters.test.ts`
Expected: FAIL — `"active"` not a filter; functions missing.

- [ ] **Step 3: Implement in `lib/admin-order-filters.ts`**

```ts
import { canonicalStatus } from "@/lib/status-display";

// The 7 canonical states plus the 'active' virtual filter (approved ∪
// in_progress — the gateway only understands single statuses, so 'active'
// fetches unfiltered and narrows client-side via applyVirtualOrderFilters).
const ADMIN_ORDER_FILTERS = [
  "draft",
  "estimated",
  "approved",
  "in_progress",
  "completed",
  "declined",
  "cancelled",
  "active",
] as const;

export type AdminOrdersFilter = "" | (typeof ADMIN_ORDER_FILTERS)[number];

// … parseAdminOrdersFilter / parseAdminOrdersSearch unchanged …

export function parseAdminOrdersToday(
  value: string | null | undefined,
): boolean {
  return value === "1";
}

/** Client-side narrowing for the virtual filters. `now` injectable for tests. */
export function applyVirtualOrderFilters<
  T extends { status: string; scheduledAt: string | Date | null },
>(rows: T[], filter: AdminOrdersFilter, today: boolean, now = new Date()): T[] {
  let out = rows;
  if (filter === "active") {
    out = out.filter((r) => {
      const s = canonicalStatus(r.status);
      return s === "approved" || s === "in_progress";
    });
  }
  if (today) {
    out = out.filter((r) => {
      if (!r.scheduledAt) return false;
      const d = new Date(r.scheduledAt);
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    });
  }
  return out;
}

function buildOrdersQuery(
  filter: AdminOrdersFilter,
  search?: string,
  filterParam: "status" | "fromStatus" = "status",
  today?: boolean,
): string {
  const qs = new URLSearchParams();
  if (filter) qs.set(filterParam, filter);
  const trimmedSearch = search?.trim();
  if (trimmedSearch) qs.set("search", trimmedSearch);
  if (today) qs.set("today", "1");
  return qs.toString();
}

export function getAdminOrdersListHref(
  filter: AdminOrdersFilter,
  search?: string,
  opts?: { today?: boolean },
): string {
  const qs = buildOrdersQuery(filter, search, "status", opts?.today);
  return qs ? `/admin/orders?${qs}` : "/admin/orders";
}
```

(`getAdminOrderDetailHref` keeps its current signature — detail back-links don't carry `today`.)

- [ ] **Step 4: Run the lib tests**

Run: `cd apps/hmls-web && bun test lib/admin-order-filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Orders page applies the virtual filters**

`app/(admin)/admin/orders/page.tsx` — in `OrdersPage()`:

```tsx
  const filter = parseAdminOrdersFilter(searchParams.get("status"));
  const today = parseAdminOrdersToday(searchParams.get("today"));
  // 'active' is client-side: fetch unfiltered, narrow below.
  const gatewayStatus = filter === "active" ? undefined : filter || undefined;
  const {
    orders: fetchedOrders,
    isLoading,
    mutate: mutateOrders,
  } = useAdminOrders(gatewayStatus, debouncedSearch || undefined);
  const orders = useMemo(
    () => applyVirtualOrderFilters(fetchedOrders, filter, today),
    [fetchedOrders, filter, today],
  );
```

URL-sync effect and `setFilter` thread `today`:

```tsx
    const desired = getAdminOrdersListHref(filter, debouncedSearch, { today });
    const current = getAdminOrdersListHref(filter, urlSearch, { today });
```
```tsx
  const setFilter = (nextFilter: typeof filter) => {
    router.replace(getAdminOrdersListHref(nextFilter, debouncedSearch, { today }), {
      scroll: false,
    });
  };
```

Add the Active chip to `FILTER_GROUPS` (after "All"):

```tsx
const FILTER_GROUPS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Pending Review" },
  { value: "estimated", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
] satisfies { value: AdminOrdersFilter; label: string }[];
```

And a dismissible Today chip in the filters row (right after the MORE_FILTERS dropdown/buttons):

```tsx
        {today && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              router.replace(getAdminOrdersListHref(filter, debouncedSearch), {
                scroll: false,
              })
            }
          >
            Scheduled today ×
          </Button>
        )}
```

Imports to update: add `applyVirtualOrderFilters, parseAdminOrdersToday` to the
`@/lib/admin-order-filters` import; ensure `useMemo` is imported from react.

- [ ] **Step 6: Dashboard tiles link to what they count**

`app/(admin)/admin/page.tsx`:

- "Today's jobs" tile: `href="/admin/orders?status=active&today=1"`
- "Active jobs" tile: `href="/admin/orders?status=active"`
- "Upcoming bookings" ListSection: `href="/admin/orders?status=active"`

(The funnel row hrefs at lines ~106-116 stay pure-status — they mirror the funnel counts.)

- [ ] **Step 7: Gates + commit**

Run: `cd apps/hmls-web && bun run typecheck && bun run lint && bun run test`

```bash
git add apps/hmls-web/lib/admin-order-filters.ts apps/hmls-web/lib/admin-order-filters.test.ts \
  "apps/hmls-web/app/(admin)/admin/orders/page.tsx" "apps/hmls-web/app/(admin)/admin/page.tsx"
git commit -m "feat(admin): active/today order filters; dashboard tiles link to what they count

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Delete `/portal/bookings` (page, nav, hook, gateway routes)

**Files:**
- Delete: `app/(portal)/portal/bookings/` (whole directory)
- Modify: `lib/nav.ts` (drop Bookings item + now-unused `Calendar` icon import)
- Modify: `hooks/usePortal.ts` (drop `usePortalBookings` + `PortalBookingRow`)
- Modify: `lib/api-paths.ts` (drop `bookings` + `cancelBooking` entries)
- Modify: `apps/gateway/src/routes/portal.ts` (drop `GET /me/bookings` +
  `POST /me/orders/:id/cancel-booking` + `CustomerOrderRowWithIntake` type)

Pre-verified: the only consumers of `usePortalBookings`, `PortalBookingRow`,
`portalPaths.bookings`, and `portalPaths.cancelBooking` are the bookings page itself.
Customer cancel remains available via `POST /me/orders/:id/cancel` (same `cancelled` transition,
same allowed from-states), which the order detail page already uses.

- [ ] **Step 1: Delete the page and nav item**

```bash
rm -r "apps/hmls-web/app/(portal)/portal/bookings"
```

`lib/nav.ts` — remove the Bookings row (and the `Calendar` import at the top):

```ts
export const portalNavItems: NavItem[] = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/orders", label: "My Orders", icon: ClipboardList },
  { href: "/portal/profile", label: "Profile", icon: User },
];
```

- [ ] **Step 2: Drop the hook, the row type, and the api paths**

`hooks/usePortal.ts`: delete `usePortalBookings`, the `PortalBookingRow` export, and the
`OrderWithIntake` import if now unused.
`lib/api-paths.ts`: delete the `bookings:` and `cancelBooking:` entries from `portalPaths`.

- [ ] **Step 3: Drop the gateway routes**

`apps/gateway/src/routes/portal.ts`: delete the `GET /me/bookings` handler (lines ~83-103), the
`POST /me/orders/:id/cancel-booking` handler (lines ~271-298), the
`CustomerOrderRowWithIntake` type alias (line ~28), and any now-unused imports
(`OrderRowWithIntake`, `schema.orderIntake` usage if bookings was its only reader in this file —
check with grep before removing shared imports).

- [ ] **Step 4: Confirm nothing references the deleted names**

Run: `grep -rn "usePortalBookings\|PortalBookingRow\|cancelBooking\|me/bookings" apps/ packages/ --include="*.ts" --include="*.tsx"`
Expected: no hits.

- [ ] **Step 5: Gates (web + gateway)**

Run: `cd apps/hmls-web && bun run typecheck && bun run lint && bun run test`
Run from repo root: `deno task check && deno task lint && deno task fmt:check`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A "apps/hmls-web/app/(portal)/portal" apps/hmls-web/lib/nav.ts apps/hmls-web/hooks/usePortal.ts \
  apps/hmls-web/lib/api-paths.ts apps/gateway/src/routes/portal.ts
git commit -m "refactor(portal): delete redundant bookings page + gateway routes (orders is SSOT)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full gate + QA + PR

- [ ] **Step 1: Full local CI**

From `apps/hmls-web`: `bun run lint && bun run typecheck && bun run test && infisical run --env=dev -- bun run build`
From repo root: `deno task check && deno task lint && deno task fmt:check`
Expected: all pass. Do not push otherwise.

- [ ] **Step 2: Browser QA (anonymous flows)**

Preview server: visit `/portal` logged out → should land on `/login?next=%2Fportal`; the portal
nav no longer shows Bookings; `/admin/orders?status=active&today=1` renders with the Active chip
selected and a dismissible "Scheduled today ×" chip (list empty without admin auth — layout gate
only). Role-gated behavior (portal denied state, tile counts) is code-review-verified.

- [ ] **Step 3: Push and open PR-2**

`/ship` flow, titled `feat(web): login next-param, explicit portal 403, honest dashboard tiles, drop portal bookings`,
body ending with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
