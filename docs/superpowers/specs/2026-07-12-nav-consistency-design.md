# Navigation & Entry-Point Consistency — Design

**Date:** 2026-07-12 **Scope:** hmls-web navigation surfaces (desktop Navbar, MobileNav,
DashboardLayout sidebars, dashboard tiles, login/logout flow, portal pages) across roles (anonymous,
customer, mechanic, admin, owner) × devices (desktop, mobile). **Source:** 5-way parallel audit +
per-finding adversarial verification (35 confirmed findings, deduplicated to 14 issues; 12
actionable).

## Context

A session of mobile-menu fixes established these rules (already implemented, uncommitted on this
branch):

- One hamburger on mobile. Section nav (admin/portal/mechanic) lives inside MobileNav; the
  DashboardLayout mobile hamburger and Sheet are deleted.
- Shared nav-item arrays in `lib/nav.ts` (`adminNavItems`, `portalNavItems`, `mechanicNavItems`).
- Inside a section, the mobile menu shows: section nav + links to _other_ sections + Theme/Sign Out.
  Marketing links (Home/Contact) hidden in-section; current-section link suppressed.
- Admin chat top-nav link removed (admins use the sidebar Chat).
- Mobile "Mechanic" cross-section link gated `isMechanic` only.

The audit found the desktop navbar and several flows contradict these rules or were already broken.
This design covers the remediation, split into two PRs.

Role facts (from `AuthProvider` + gateway middleware) that drive several fixes:

- Roles are mutually exclusive: `customer | mechanic | admin | owner`. `isAdmin = admin|owner`;
  `isMechanic = mechanic` only.
- `/mechanic` gateway middleware accepts roles `mechanic`/`admin` with a linked `providers` row;
  role `owner` is rejected outright. So the Mechanic link 403s for admins without a provider row and
  for **all** owners.
- Portal APIs 403 (`No customer account found`) for auth users with no `customers` row — typical for
  staff accounts.

## Non-goals

- Footer-only reachability of Services/Areas pages (deliberate SEO layout; unchanged).
- Marketing-page body CTAs bouncing admins through `/chat` → `/admin/chat` (harmless redirect chain;
  unchanged).
- Any multi-tenancy behavior changes beyond exposing the existing ShopSwitcher on mobile.
- Desktop visual redesign — desktop only adopts the same _visibility rules_ mobile already has.

---

## PR-1 — Navigation consistency (nav layer only)

Includes the already-implemented mobile changes listed in Context, plus:

### 1.1 Desktop Mechanic link: `isMechanic` only

`Navbar.tsx`: change the gate `(isMechanic || isAdmin)` → `isMechanic`, matching mobile. Admins
reach mechanic _data_ via `/admin/mechanics`; the mechanic self-service panel is for mechanics. Also
align MobileNav's `/mechanic` **section detection** to `isMechanic` only (currently
`isMechanic || isAdmin`), so a staff user stuck on a 403'd `/mechanic` path gets the normal menu
instead of a dead mechanic sub-nav.

### 1.2 ShopSwitcher on mobile (owner)

`MobileNav.tsx`: render `{isOwner && <ShopSwitcher />}` inside the open menu (its own row above the
Theme row). `activeShop` persists in localStorage and stamps `X-Shop-Id` on every admin API request,
so without this an owner on a phone is silently pinned to whatever scope was last set on desktop and
a mobile-only owner can never scope at all. ShopSwitcher already self-hides for non-owners/empty
shop lists; no extra gating.

### 1.3 Desktop navbar becomes section-aware

Hoist the section-detection helper and the link constants (`marketingLinks`, `portalLink`,
`adminLink`, `mechanicLink`, chat link) from Navbar/MobileNav duplication into `lib/nav.ts`. Apply
mobile's visibility rules to the desktop Navbar:

- Inside a section: hide Home/Contact; hide the current-section link; keep other-section links,
  ShopSwitcher (owner), Theme, Sign Out.
- Outside sections: unchanged marketing navbar.

### 1.4 Single `/chat` entry point; staff never see the customer CTA

- Delete the plain "Chat" text link (desktop + mobile) — it duplicated the "Get a Quote" CTA
  (identical destination `/chat`).
- Gate the "Get a Quote" CTA `!isAdmin && !isMechanic && section !== "mechanic"` (staff aren't
  quote-seeking customers). It stays visible in the portal menu — portal is the customer's space and
  the CTA is their primary action; with the "Chat" link gone it is also their only nav entry to
  `/chat` while in-portal.

### 1.5 Rename mechanic nav item "My Bookings" → "My Jobs"

`lib/nav.ts`: label change only, matching the page's own h1 and the post-Layer-3 domain language.

### 1.6 Portal empty states get a real action

`EmptyState` already supports `action: { label, href }`. Pass
`action={{ label: "Start a chat", href: "/chat" }}` on the My Orders empty state (the Bookings page
is deleted in PR-2).

### 1.7 Sign-out lands on the homepage

Extract one shared sign-out handler used by Navbar + MobileNav: `await supabase.auth.signOut()` then
`router.push("/")`. Today, signing out inside a section drops the user on `/login` (the section
guard's redirect), which reads as a failed sign-out.

---

## PR-2 — Flow fixes (routes + gateway)

### 2.1 Login honors the original destination (`?next=`)

- Guards that currently `router.push("/login")` (DashboardLayout; the `/chat` page guard) append
  `?next=<encodeURIComponent(pathname + search)>`.
- The login page reads `next`, validates it (must start with `/`, must not start with `//`), and
  pushes it after the session is established. OAuth flows thread it through the auth callback
  (`redirectTo: /auth/callback?next=...`) with the same validation.
- Default when no valid `next`: role-based — admin/owner → `/admin`, mechanic → `/mechanic`,
  customer → `/chat` (today's hardcoded `/chat` misroutes staff and breaks email deep links like
  `/portal/orders`).
- Validation helper lives in `lib/` with a unit test (open-redirect guard is a trust boundary).

### 2.2 Portal 403 becomes an explicit state; mechanics lose the portal link

- `DashboardLayout` gains `portalCheck` (guard endpoint `/api/portal/me`), reusing the existing
  adminCheck/mechanicCheck plumbing and Access Denied screen ("No customer account linked…"). Portal
  layout adopts it — today the portal pages swallow SWR errors and render a fake empty "You're all
  caught up" dashboard for staff accounts with no customers row.
- Hide the portal link ("My Portal") for `isMechanic` on both devices. Admins keep "View as
  Customer" (they now hit the explicit denied state instead of a fake portal when no customer row
  exists).

### 2.3 Admin dashboard tiles link to what they count

Admin orders list (`lib/admin-order-filters.ts` + orders page) gains:

- A virtual status filter `active` = `approved ∪ in_progress`.
- A `today=1` param filtering to `scheduledAt` within the local day.

Tiles: "Active jobs" → `/admin/orders?status=active`; "Today's jobs" →
`/admin/orders?status=active&today=1`. "Upcoming bookings" section link → `?status=active`.
Implementation may filter client-side on the fetched list if the gateway query only supports a
single status; the plan decides based on the current fetch path.

### 2.4 Delete `/portal/bookings` (filtered duplicate of My Orders)

Since the `bookings` table was dropped, the page is "orders WHERE scheduledAt IS NOT NULL"; its
cards deep-link to the same `/portal/orders/:id` detail, and its one unique action (cancel an
approved appointment) exists on the detail page. Remove:

- `app/(portal)/portal/bookings/` page; `portalNavItems` "Bookings" entry.
- `usePortalBookings` hook; gateway `GET /me/bookings` route.
- Gateway `POST /me/orders/:id/cancel-booking` — collapse into the existing
  `POST /me/orders/:id/cancel` (same transition, same guard set; keep the customer-facing reason
  plumbing).

Deferred (YAGNI until asked): an "Upcoming appointment" strip on the portal dashboard.

---

## Testing & verification

- Unit: `next` validation helper; `active`/`today` filter parsing (both live in `lib/` next to
  existing `*.test.ts`).
- Existing gates per PR: `bun run lint` / `typecheck` / `test` / `build`, `deno task check` (PR-2
  touches gateway).
- Manual QA matrix (preview browser): anonymous marketing + portal menus (mobile/desktop); logged-in
  flows that require roles are verified by code review — local role simulation isn't available.
- Rollout order: PR-1 then PR-2 (PR-2 removes the Bookings nav entry PR-1 still renders).

## Risks

- 2.1 touches auth redirects — open-redirect validation is the trust boundary; helper + test
  required, no absolute URLs accepted.
- 2.4 removes a gateway route; grep for remaining `me/bookings` / `cancel-booking` callers (web
  `api-paths.ts`) before deletion.
- 1.3 changes desktop navbar composition for logged-in staff; screenshot before/after in the PR
  description.
