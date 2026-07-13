# Nav Consistency PR-1 (nav layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every navigation surface (desktop Navbar, MobileNav) obey one set of role/section
visibility rules, with the nav vocabulary defined once in `lib/nav.ts`.

**Architecture:** `lib/nav.ts` becomes the single source for nav items, link constants, and section
detection. `Navbar.tsx` (desktop) and `MobileNav.tsx` (mobile) both consume it and apply identical
rules: inside a section show section nav + other-section links + Theme/Sign Out; marketing links
only outside sections; Mechanic link for mechanics only; one `/chat` entry ("Get a Quote") for
non-staff; sign-out lands on `/`.

**Tech Stack:** Next.js 16 App Router (client components), Tailwind, Bun test for `lib/`.

**Spec:** `docs/superpowers/specs/2026-07-12-nav-consistency-design.md` (PR-1 section).

## Global Constraints

- Package manager/test runner: `bun` (never npm/npx). Tests live next to code as `lib/*.test.ts`.
- Formatting: Biome — double quotes, 2-space indent. Run `bun run lint` from `apps/hmls-web`.
- TypeScript strict; `bun run typecheck` must pass.
- Commits: conventional format (`feat(web): …`, `refactor(web): …`).
- All paths below are relative to `apps/hmls-web/` unless prefixed with `docs/`.
- Component changes have no unit-test harness in this repo — verify via typecheck + build + browser
  preview; only `lib/` logic gets bun tests.
- Do NOT commit `.claude/launch.json` (session-local dev config).

---

### Task 0: Commit the already-made session changes as the base

The worktree already contains the mobile-menu rework (uncommitted). Lock it in as the PR's first
commit so later tasks diff cleanly.

**Files (already modified, just commit):**

- `components/DashboardLayout.tsx`, `components/MobileNav.tsx`, `components/Navbar.tsx`
- `lib/nav.ts`
- `app/(admin)/admin/layout.tsx`, `app/(portal)/portal/layout.tsx`,
  `app/(mechanic)/mechanic/layout.tsx`

- [ ] **Step 1: Verify the tree state and gates**

Run: `cd apps/hmls-web && bun run lint && bun run typecheck && bun run test` Expected: all pass
(they passed at the end of the interactive session).

- [ ] **Step 2: Commit (exclude .claude/launch.json)**

```bash
git add apps/hmls-web/components/DashboardLayout.tsx apps/hmls-web/components/MobileNav.tsx \
  apps/hmls-web/components/Navbar.tsx apps/hmls-web/lib/nav.ts \
  "apps/hmls-web/app/(admin)/admin/layout.tsx" "apps/hmls-web/app/(portal)/portal/layout.tsx" \
  "apps/hmls-web/app/(mechanic)/mechanic/layout.tsx"
git commit -m "refactor(web): single mobile hamburger, section-focused mobile menu, shared nav items

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: `lib/nav.ts` — section detection + shared link constants (+ "My Jobs" rename)

**Files:**

- Modify: `lib/nav.ts`
- Test: `lib/nav.test.ts` (new)

**Interfaces:**

- Produces: `type Section = "admin" | "portal" | "mechanic"`;
  `detectSection(pathname: string, roles: { isAdmin: boolean; isMechanic: boolean }): Section | null`;
  `sectionNavItems: Record<Section, NavItem[]>`;
  `marketingLinks: readonly { href: string; label: string }[]`; `portalLink`, `adminLink`,
  `mechanicLink`, `chatCta`: `{ href: string; label: string }`.
- Consumes: existing `NavItem`, `adminNavItems`, `portalNavItems`, `mechanicNavItems`.

- [ ] **Step 1: Write the failing test**

Create `lib/nav.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { detectSection, mechanicNavItems, sectionNavItems } from "./nav";

const roles = (isAdmin: boolean, isMechanic: boolean) => ({ isAdmin, isMechanic });

describe("detectSection", () => {
  test("portal paths are a section for any role", () => {
    expect(detectSection("/portal", roles(false, false))).toBe("portal");
    expect(detectSection("/portal/orders/5", roles(true, false))).toBe("portal");
  });

  test("admin paths are a section only for admins", () => {
    expect(detectSection("/admin/orders", roles(true, false))).toBe("admin");
    expect(detectSection("/admin/orders", roles(false, false))).toBeNull();
    expect(detectSection("/admin", roles(false, true))).toBeNull();
  });

  test("mechanic paths are a section only for mechanics (admins 403 there)", () => {
    expect(detectSection("/mechanic", roles(false, true))).toBe("mechanic");
    expect(detectSection("/mechanic/time-off", roles(true, false))).toBeNull();
  });

  test("marketing paths are no section", () => {
    expect(detectSection("/", roles(true, true))).toBeNull();
    expect(detectSection("/contact", roles(false, false))).toBeNull();
  });
});

describe("nav vocabulary", () => {
  test("mechanic home item is labeled My Jobs (page h1 parity)", () => {
    expect(mechanicNavItems[0]?.label).toBe("My Jobs");
  });

  test("sectionNavItems maps every section", () => {
    expect(Object.keys(sectionNavItems).sort()).toEqual(["admin", "mechanic", "portal"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/hmls-web && bun test lib/nav.test.ts` Expected: FAIL — `detectSection` /
`sectionNavItems` not exported; label is "My Bookings".

- [ ] **Step 3: Implement in `lib/nav.ts`**

Change the mechanic label:

```ts
export const mechanicNavItems: NavItem[] = [
  { href: "/mechanic", label: "My Jobs", icon: CalendarCheck },
  { href: "/mechanic/availability", label: "Weekly Hours", icon: CalendarDays },
  { href: "/mechanic/time-off", label: "Time Off", icon: CalendarOff },
];
```

Append below the nav-item arrays (before `isSectionNavActive`):

```ts
export type Section = "admin" | "portal" | "mechanic";

/** Which dashboard section a pathname belongs to, for the CURRENT viewer.
 *  Admin/mechanic paths only count when the viewer can actually use that
 *  section (roles are mutually exclusive; admins 403 on /mechanic). */
export function detectSection(
  pathname: string,
  roles: { isAdmin: boolean; isMechanic: boolean },
): Section | null {
  if (pathname.startsWith("/portal")) return "portal";
  if (pathname.startsWith("/admin") && roles.isAdmin) return "admin";
  if (pathname.startsWith("/mechanic") && roles.isMechanic) return "mechanic";
  return null;
}

export const sectionNavItems: Record<Section, NavItem[]> = {
  admin: adminNavItems,
  portal: portalNavItems,
  mechanic: mechanicNavItems,
};

// Shared link vocabulary — Navbar (desktop) and MobileNav must not each
// define their own copies.
export const marketingLinks = [
  { href: "/", label: "Home" },
  { href: "/contact", label: "Contact" },
] as const;

export const portalLink = { href: "/portal", label: "My Portal" } as const;
export const adminLink = { href: "/admin", label: "Admin" } as const;
export const mechanicLink = { href: "/mechanic", label: "Mechanic" } as const;
/** The single customer entry to /chat. The plain "Chat" text link is gone. */
export const chatCta = { href: "/chat", label: "Get a Quote" } as const;
```

- [ ] **Step 4: Run tests**

Run: `cd apps/hmls-web && bun test lib/nav.test.ts` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hmls-web/lib/nav.ts apps/hmls-web/lib/nav.test.ts
git commit -m "feat(web): shared nav vocabulary + section detection in lib/nav; rename My Bookings -> My Jobs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: MobileNav — consume shared nav, ShopSwitcher for owners, single /chat entry

**Files:**

- Modify: `components/MobileNav.tsx`

**Interfaces:**

- Consumes (from Task 1): `detectSection`, `sectionNavItems`, `marketingLinks`, `portalLink`,
  `adminLink`, `mechanicLink`, `chatCta`, `isSectionNavActive`.
- Consumes: `ShopSwitcher` from `@/components/admin/ShopSwitcher` (self-hides unless owner with
  shops).

Behavior after this task (mobile menu):

- anonymous/customer marketing: Home, Contact, [My Portal if logged in], Theme, Sign In/Out, Get a
  Quote.
- customer in /portal: portal nav, Theme, Sign Out, Get a Quote (portal is customer space — CTA
  stays).
- mechanic anywhere: never sees Get a Quote. In /mechanic: mechanic nav + My Portal + Theme/Sign Out
  (hiding My Portal for mechanics lands in PR-2, together with the portal-403 fix).
- admin in /admin: admin nav, View as Customer, Theme, Sign Out.
- owner: additionally a ShopSwitcher row above Theme, in every menu state.

- [ ] **Step 1: Replace imports and local constants**

Top of `components/MobileNav.tsx` — replace the current import block and constants
(`marketingLinks`, `customerChatLink`, `portalLink`, `adminLink`, `mechanicLink` local consts all go
away):

```tsx
"use client";

import { LogIn, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ShopSwitcher } from "@/components/admin/ShopSwitcher";
import { useAuth } from "@/components/AuthProvider";
import {
  adminLink,
  chatCta,
  detectSection,
  isSectionNavActive,
  marketingLinks,
  mechanicLink,
  portalLink,
  sectionNavItems,
} from "@/lib/nav";
import ThemeToggle from "./ThemeToggle";
```

- [ ] **Step 2: Use detectSection and destructure isOwner**

Replace the destructure and the section/subNav computation inside the component:

```tsx
const { user, supabase, isLoading, isAdmin, isMechanic, isOwner } = useAuth();
```

```tsx
// Section sub-nav — the single mobile menu carries the dashboard nav
// (the desktop sidebar's items) so dashboard pages don't need a second
// hamburger of their own. Inside a section the menu stays focused: section
// nav + links to the OTHER sections + theme/sign-out. Marketing links only
// show outside sections (the logo already links home).
const section = detectSection(pathname, { isAdmin, isMechanic });
const subNav = section ? sectionNavItems[section] : null;
const subNavRoot = subNav?.[0]?.href ?? "/";
```

- [ ] **Step 3: Delete the plain "Chat" link block**

Remove the whole `{!section && !isAdmin && (<Link href={customerChatLink.href} …>…</Link>)}` block
(the one rendering the plain "Chat" text link between the marketing links and the `{user && …}` role
links) — it duplicated the CTA.

- [ ] **Step 4: Add ShopSwitcher row above the Theme row**

```tsx
{
  isOwner && (
    <div className="flex items-center gap-2">
      <ShopSwitcher />
    </div>
  );
}
<div className="flex items-center gap-2">
  <ThemeToggle />
  <span className="text-sm text-text-secondary">Theme</span>
</div>;
```

- [ ] **Step 5: Re-gate the Get a Quote CTA and use chatCta**

Replace the bottom CTA block:

```tsx
{
  !isAdmin && !isMechanic && (
    <Link
      href={chatCta.href}
      onClick={close}
      className="px-4 py-3 bg-red-primary text-white text-center rounded-lg font-medium hover:bg-red-dark transition-colors"
    >
      {chatCta.label}
    </Link>
  );
}
```

- [ ] **Step 6: Typecheck + lint**

Run: `cd apps/hmls-web && bun run typecheck && bun run lint` Expected: PASS (no unused imports —
`customerChatLink` local const must be gone).

- [ ] **Step 7: Commit**

```bash
git add apps/hmls-web/components/MobileNav.tsx
git commit -m "feat(web): mobile menu consumes shared nav vocab; owner ShopSwitcher; single /chat CTA

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Navbar (desktop) — section-aware, mechanic link for mechanics only

**Files:**

- Modify: `components/Navbar.tsx`

**Interfaces:**

- Consumes (Task 1): `detectSection`, `marketingLinks`, `portalLink`, `adminLink`, `mechanicLink`,
  `chatCta`.

Desktop rules after this task (mirrors mobile):

- Inside a section: no Home/Contact, no current-section link; other-section links + ShopSwitcher
  (owner) + Theme + Sign Out (+ Get a Quote for customers in /portal).
- Mechanic link: `isMechanic` only (admins 403 on /mechanic; owners always 403).
- Plain "Chat" text link deleted; `Get a Quote` CTA gated `!isAdmin && !isMechanic`.

- [ ] **Step 1: Imports + section**

Replace Navbar's local constants (`marketingLinks`, `customerChatLink`, `portalLink`, `adminLink`,
`mechanicLink`) with imports, and compute `section`:

```tsx
import {
  adminLink,
  chatCta,
  detectSection,
  marketingLinks,
  mechanicLink,
  portalLink,
} from "@/lib/nav";
```

Inside the component, after the `useAuth()` destructure (which already provides `isAdmin`,
`isMechanic`, `isOwner`):

```tsx
const section = detectSection(pathname, { isAdmin, isMechanic });
```

- [ ] **Step 2: Rewrite the desktop nav block**

Replace the whole `{/* Desktop nav */}` div content with (link className helper stays the same
pattern — factor the ternary into a small local `linkCls(active: boolean)` to avoid five copies):

```tsx
{/* Desktop nav */}
<div className="hidden md:flex items-center gap-8">
  {!section &&
    marketingLinks.map(({ href, label }) => (
      <Link key={href} href={href} prefetch={false} className={linkCls(pathname === href)}>
        {label}
      </Link>
    ))}
  {isUserLoggedIn && section !== "portal" && (
    <Link href={portalLink.href} prefetch={false} className={linkCls(false)}>
      {isAdmin ? "View as Customer" : portalLink.label}
    </Link>
  )}
  {isAdmin && section !== "admin" && (
    <Link href={adminLink.href} prefetch={false} className={linkCls(false)}>
      {adminLink.label}
    </Link>
  )}
  {isMechanic && section !== "mechanic" && (
    <Link href={mechanicLink.href} prefetch={false} className={linkCls(false)}>
      {mechanicLink.label}
    </Link>
  )}
  {isOwner && <ShopSwitcher />}
  <ThemeToggle />
  {
    /* KEEP the existing `{!isLoading && (isUserLoggedIn ? <button…Sign Out…> : <Link…Sign In…>)}`
              block here verbatim — only its onClick changes later, in Task 4. */
  }
  {!isAdmin && !isMechanic && (
    <Link
      href={chatCta.href}
      prefetch={false}
      className="px-5 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
    >
      {chatCta.label}
    </Link>
  )}
</div>;
```

with the helper defined above the `return`:

```tsx
const linkCls = (active: boolean) =>
  `text-sm transition-colors rounded focus-visible:ring-2 focus-visible:ring-red-primary ${
    active
      ? "text-red-400"
      : isTransparent
      ? "text-white/70 hover:text-white"
      : "text-text-secondary hover:text-text"
  }`;
```

Notes: the old active-state ternaries on Portal/Admin/Mechanic links are dead once the
current-section link is suppressed (you can never be _in_ the section a rendered link points to) —
pass `linkCls(false)`. Delete the stale comment about admins entering the mechanic panel.

- [ ] **Step 3: Typecheck + lint + build**

Run:
`cd apps/hmls-web && bun run typecheck && bun run lint && infisical run --env=dev -- bun run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/hmls-web/components/Navbar.tsx
git commit -m "feat(web): section-aware desktop navbar; mechanic link for mechanics only; single /chat CTA

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Shared sign-out that lands on the homepage

**Files:**

- Create: `hooks/useSignOut.ts`
- Modify: `components/Navbar.tsx` (sign-out button), `components/MobileNav.tsx` (sign-out button)

**Interfaces:**

- Produces: `useSignOut(): () => Promise<void>` — signs out then `router.push("/")`.

- [ ] **Step 1: Create the hook**

`hooks/useSignOut.ts`:

```ts
"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";

/** Sign out and land on the homepage — NOT on the section guard's /login
 *  redirect, which reads as a failed sign-out. */
export function useSignOut() {
  const { supabase } = useAuth();
  const router = useRouter();
  return useCallback(async () => {
    await supabase.auth.signOut();
    router.push("/");
  }, [supabase, router]);
}
```

- [ ] **Step 2: Wire into both navs**

Navbar: `const signOut = useSignOut();` and the button becomes `onClick={() => void signOut()}`
(drop the inline `supabase.auth.signOut()`). MobileNav: same, keeping the `close()` call:

```tsx
<button
  type="button"
  onClick={() => {
    void signOut();
    close();
  }}
```

- [ ] **Step 3: Typecheck + lint**

Run: `cd apps/hmls-web && bun run typecheck && bun run lint` Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/hmls-web/hooks/useSignOut.ts apps/hmls-web/components/Navbar.tsx apps/hmls-web/components/MobileNav.tsx
git commit -m "fix(web): sign-out lands on homepage instead of the login form

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Portal orders empty state gets a "Start a chat" action

**Files:**

- Modify: `app/(portal)/portal/orders/page.tsx:181-184`

- [ ] **Step 1: Pass the action prop**

```tsx
<EmptyState
  icon={ClipboardList}
  message="No orders yet. Start a chat to get an estimate!"
  action={{ label: "Start a chat", href: "/chat" }}
/>;
```

- [ ] **Step 2: Typecheck, commit**

Run: `cd apps/hmls-web && bun run typecheck`

```bash
git add "apps/hmls-web/app/(portal)/portal/orders/page.tsx"
git commit -m "fix(web): portal orders empty state links to /chat

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full gate + browser QA

- [ ] **Step 1: Full local CI**

Run from `apps/hmls-web`:
`bun run lint && bun run typecheck && bun run test && infisical run --env=dev -- bun run build` Then
from repo root: `deno task check` (unchanged code, but it's the pre-push contract). Expected: all
pass.

- [ ] **Step 2: Browser QA (preview server, anonymous flows)**

With the dev server (`.claude/launch.json` config "web"): at mobile width open `/` menu (expect
Home/Contact/Theme/Sign In/Get a Quote — NO plain Chat link), `/portal` menu (portal nav with NO
Bookings label change yet — Bookings stays until PR-2; Theme/Sign In/Get a Quote). At desktop width
check `/` (marketing links + Get a Quote) and `/portal` (no Home/Contact, no My Portal self-link).
Role-gated states (admin/owner/mechanic) are verified by code review — no local role simulation.

- [ ] **Step 3: Push and open PR-1**

Use the repo's `/ship` flow (or `git push -u origin HEAD` + `gh pr create`) titled
`feat(web): consistent role/section navigation across desktop and mobile`, body summarizing the
rules table + before/after screenshots, ending with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
