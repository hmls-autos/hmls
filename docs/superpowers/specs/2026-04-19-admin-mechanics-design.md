# Admin Mechanics Management — Design Spec

Date: 2026-04-19
Status: Approved

## Goal

Give admins a first-class surface to manage mechanics (the `providers` table):
see the fleet at a glance, create and edit mechanics, override their schedules,
and reassign bookings between them. Replaces the current situation where admins
have no UI for mechanic management at all.

The central visual metaphor is a **Fleet Board** — a grid of mechanic cards
that communicates who is working, who is overloaded, and who is underutilized
without needing to open any details.

## Non-goals

- Map-based coverage view (may be added later as an additional tab).
- Schedule heatmap across all mechanics (may be added later).
- Payroll / commission calculations beyond a read-only 30-day earnings figure
  derived from existing data.
- Self-service mechanic onboarding (admin invites / creates mechanics; the
  mechanic signs in via existing Supabase auth + RBAC hook).

## Architecture

### Routes

New admin area under the existing `(admin)` route group:

```
app/(admin)/admin/mechanics/
  page.tsx          Fleet board (grid of cards, KPI strip, filters)
  [id]/page.tsx     Mechanic detail (profile, 7-day schedule, bookings, KPIs)
```

Create flow is an in-page Dialog on the Fleet board, not a separate `/new`
route — lighter UX for a short form.

### Nav

Add a "Mechanics" entry (Wrench icon from `lucide-react`) to the nav array in
`apps/hmls-web/app/(admin)/admin/layout.tsx`, positioned between "Schedule"
and "Customers".

### Backend

New Hono sub-router at `apps/gateway/src/routes/admin-mechanics.ts`, mounted
under `/admin/mechanics/*` in `apps/gateway/src/hmls-app.ts`. Guarded by the
existing admin middleware (`apps/gateway/src/middleware/admin.ts`). No new
tables — all operations use `providers`, `providerAvailability`,
`providerScheduleOverrides`, and `bookings`.

### Frontend data layer

New hook file `apps/hmls-web/hooks/useAdminMechanics.ts`. Matches the patterns
already used by `hooks/useAdmin.ts` and `hooks/useMechanic.ts` (plain `fetch`
+ the existing cache/mutation story in this repo — implementation will match
whatever `useAdmin.ts` uses today).

## API

All endpoints under `/admin/mechanics/*`. All require admin JWT (existing
middleware).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | List mechanics with aggregate stats |
| POST | `/` | Create a mechanic |
| GET | `/:id` | Full mechanic profile |
| PATCH | `/:id` | Edit profile fields (name, email, phone, specialties, service radius, home base, timezone, isActive, authUserId) |
| DELETE | `/:id` | Soft delete — sets `isActive = false`. Never hard-deletes because `bookings.providerId` references the row. |
| GET | `/:id/availability` | Read weekly hours |
| PUT | `/:id/availability` | Admin overwrite of weekly hours (same validation as mechanic self-service) |
| GET | `/:id/overrides` | Read schedule overrides (time off, extra hours) |
| POST | `/:id/overrides` | Admin create / upsert override |
| DELETE | `/:id/overrides/:overrideId` | Admin delete override |
| GET | `/:id/bookings` | Mechanic's bookings, supports `from` / `to` query params |
| POST | `/bookings/:bookingId/reassign` | Body `{ providerId }` — change a booking's assigned mechanic |

### Aggregate fields returned by `GET /`

Each row in the list response includes:

- Core `providers` fields (id, name, email, phone, isActive, timezone, etc.)
- `upcomingBookingsCount` — `bookings` where `providerId = this` and
  `scheduledAt >= now()` and `status IN ('requested','confirmed')`.
- `weekUtilization` — `bookedMinutesThisWeek / availableMinutesThisWeek`.
  - Available minutes: sum of `providerAvailability` rows for weekdays that
    fall in `[start of week, end of week]`, minus any unavailable overrides
    in that range, plus any extra-hours overrides.
  - Booked minutes: sum of duration of bookings in that range with
    `status IN ('confirmed','completed')`.
  - Null when availableMinutes == 0 (not set up yet).
- `earnings30d` — sum of `totalAmount` (cents) from `quotes` linked to this
  provider's bookings where `status = 'paid'` in the last 30 days. If the
  `quotes.bookingId → bookings.providerId` chain doesn't cleanly join in the
  current schema, implementation will use the closest equivalent rather than
  introduce new columns; if no clean derivation exists, the field is omitted
  from the response and the UI hides the Earnings line.
- `nextBookingAt` — earliest `scheduledAt` of a future
  `requested`/`confirmed` booking.
- `isOnJobNow` — `true` iff `now()` falls inside a `confirmed` booking's
  `[scheduledAt, scheduledAt + duration]` window.

### Reassign endpoint

`POST /bookings/:bookingId/reassign` validates:

1. Booking exists.
2. New `providerId` exists and `isActive = true` (unless admin passes
   `force: true` — see UI note on "reassign to mechanic who looks busy").
3. Target mechanic is not already the current one (no-op rejected).

On success: update `bookings.providerId` + `updatedAt`, return updated row.
The existing `notifyBookingStatusChange` helper is not called here (status
unchanged); if this flow needs its own notification it'll be added as a
follow-up.

## UI

### Fleet board — `/admin/mechanics`

Header row:
- Title "Mechanics".
- Right: `+ Add Mechanic` button (opens Dialog).

Filter chips below header: `All` / `Active` / `Inactive` / `Available today`
(the last one filters to mechanics who have availability configured for the
current day and no blocking override).

KPI strip (one row, four compact cards):
- Total mechanics · Active now · Avg week utilization · Bookings this week.

Main grid: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`.

Each card shows:
- Initials avatar + name + status dot (`● On a job now` / `● Active` /
  `○ Inactive`).
- Email + phone line.
- Utilization bar for this week with `${pct}%` label. Color steps:
  - `< 40%` → muted/grey (underutilized)
  - `40–80%` → green (healthy)
  - `80–95%` → amber (running hot)
  - `> 95%` → red (overloaded)
- Next booking line (`Next: Tue 2:30 PM — Brake service`) or "No upcoming
  bookings".
- Upcoming-week count.
- Earnings (30d), formatted via existing `formatCents`.
- Footer actions: `Toggle active` (inline) and `View →` (link to detail).

Empty state: single centered card "No mechanics yet · Add your first".

### Add Mechanic Dialog

Fields:
- `name` (required)
- `email`
- `phone`
- `timezone` (default `America/Los_Angeles`)
- `serviceRadiusMiles` (default 30)
- `specialties` (tag input; stored as JSON array)
- `homeBaseLat` / `homeBaseLng` (two number inputs; no map picker in v1)
- `isActive` defaults to `true`

On submit: POST `/admin/mechanics/`, optimistically add to the list, close
dialog, toast on server error.

### Mechanic detail — `/admin/mechanics/[id]`

Header bar:
- Back arrow + name + active dot.
- Right: `Edit profile` · `Deactivate` / `Reactivate` (destructive variant).

Layout: on `lg+` it's a two-column layout (2/3 main + 1/3 sidebar). Below
`lg` everything stacks into one column.

**Left / main column:**

1. **Profile card** — plain read view; `Edit profile` swaps the card
   contents into a form in place (no route change). Save → PATCH, toast on
   error.

2. **7-day schedule strip** — the headline element.
   - Horizontal track of 7 day columns starting from today.
   - Each column shows a vertical time axis from 6:00 to 20:00.
   - Cell backgrounds: grey = outside weekly hours or blocked by override;
     light green = available. Booking blocks overlay as solid colored
     rectangles spanning their scheduled time range. Booking color encodes
     status (confirmed vs requested vs completed).
   - Hover a booking block → tooltip with customer + service.
   - Top-right of this module: `Edit hours` (opens weekly availability
     Dialog) and `Add time off` (opens override Dialog).
   - Implemented as an SVG or CSS grid — no chart library.

3. **Upcoming bookings list** — up to 20 next. Each row: time, customer,
   service, status chip, overflow menu with `Reassign…` (opens Reassign
   Dialog) and `Open order` (links to `/admin/orders/[id]`).

4. **Recent completed** — last 10 completed/paid jobs, with amount.

**Right / sidebar (sticky on `lg+`):**

- KPI block: Week utilization · Bookings this week · Earnings 30d · Jobs
  completed (all-time).
- Utilization sparkline: small 8-bar SVG/CSS histogram of past 8 weeks'
  utilization. No chart library.
- Danger zone card: `Deactivate` button + explanatory text ("Inactive
  mechanics won't appear for booking assignment").

### Reassign Dialog

Opened from the bookings list on the detail page (and, as a bonus, from the
existing admin order pages — this is a small addition to keep the feature
discoverable from where admins already live).

Body:
- Summary of the booking (time, customer, service).
- Dropdown of active mechanics. For each, annotate "Busy at this time"
  (dimmed) if any of their confirmed bookings overlap, but keep them
  selectable; if the admin picks a busy mechanic, show a small warning line
  before the confirm button. Submission proceeds regardless — admins
  sometimes knowingly double-book.
- `Confirm` → POST `/admin/mechanics/bookings/:id/reassign`.

## Data / Schema notes

- No migrations required. The existing `providers`, `providerAvailability`,
  `providerScheduleOverrides`, and `bookings` schemas are sufficient.
- `providers.authUserId` stays optional. A mechanic row can exist before any
  Supabase auth user is linked to it; linking happens out-of-band (existing
  RBAC hook populates the JWT claim). Admin can set `authUserId` via
  PATCH if needed in v1, but the UI does not prominently surface it — we
  expose it in the edit form under an "Advanced" toggle.
- Soft delete only. DELETE flips `isActive`. Rehydration is just a PATCH
  with `isActive = true`.

## Error handling

- Standard Hono error shape already used elsewhere: `{ error: { code, message } }`.
- Frontend surfaces errors via inline banners on pages and via the existing
  toast system on mutations.
- Validation mirrors the existing mechanic-self-service routes exactly where
  the operation is the same (weekly hours, overrides).

## Testing

- Unit tests for the aggregate computations (`weekUtilization`,
  `isOnJobNow`, `earnings30d`) — these are the only pieces with real logic
  beyond CRUD.
- Integration smoke test for the reassign endpoint: two mechanics, one
  booking, reassign, assert row changed + unauthorized path rejected.
- Manual QA for the Fleet board and detail page using seeded data.
- Typecheck + Biome lint must pass before pushing (per CLAUDE.md).

## Build sequence

1. Backend: new `admin-mechanics.ts` router with all endpoints, mounted and
   guarded.
2. Backend: unit tests for aggregate computations.
3. Frontend: `useAdminMechanics.ts` hook.
4. Frontend: Fleet board page + Add Mechanic Dialog.
5. Frontend: Mechanic detail page — profile + bookings list first.
6. Frontend: 7-day schedule strip component.
7. Frontend: Availability / time-off Dialogs (reuse shape of existing
   mechanic self-service forms).
8. Frontend: Reassign Dialog + wire into mechanic detail and admin order
   pages.
9. Nav entry in admin layout.
10. Manual QA pass + CI suite.

## Out-of-scope follow-ups

- Map tab showing home bases + service-radius circles.
- Cross-mechanic schedule heatmap.
- Invite-by-email flow that provisions a Supabase auth user.
- Route optimization / travel-time awareness in the schedule strip.
