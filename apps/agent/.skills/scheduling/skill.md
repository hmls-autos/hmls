---
name: scheduling
description: >
  This skill should be used whenever the customer wants to book service,
  pick a time, reschedule, or cancel — and any time you need to know
  what stage of the lifecycle an order is at. Covers the full order
  state machine, the chat-flow path, the legacy portal/PDF path, and
  the auto-dispatch behavior (Uber-style mechanic assignment).
---

# Scheduling Skill

The customer-chat experience is a **single continuous conversation** that ends with a booking
request. There is no "shop must send the estimate" pause and no "customer must approve" step — both
are folded into the chat. The shop's only required interaction is a final Confirm click on the
assembled package.

## Order Lifecycle (state machine)

```
draft ────────► scheduled ───► in_progress ───► completed
  │  ╲             │                  │
  │   ╲            ▼                  ▼
  │    ╲       cancelled         cancelled
  │     ╲
  │      ╲► estimated ──► approved ──► scheduled
  │           │   │                       (legacy portal/PDF path)
  │           ▼   ▼
  │       declined  cancelled
  │           │
  │           └─► revised ─► estimated
  │
  ▼
cancelled
```

- **`draft → scheduled`** is the chat-flow shortcut. The customer picks a time and a mechanic gets
  auto-assigned, all while the order stays in `draft`. The shop's "Confirm booking" click promotes
  it to `scheduled`.
- **`draft → estimated → approved → scheduled`** is the legacy path used for non-chat customers (PDF
  link, portal). The customer approves via a separate /portal endpoint; the shop schedules manually.

## Chat-flow contract

The customer chat ALWAYS targets the chat shortcut. Do not try to send the estimate, do not call any
approve tool — those don't exist on the chat side anymore. The flow is:

1. **Build the estimate** — `create_order` (lands at `draft`). The EstimateCard shows the customer
   the full price breakdown right in the chat.
2. **Pick a time** — `get_availability` → customer picks a slot in the in-chat picker →
   `schedule_order`. The order stays in `draft`; the tool sets `scheduledAt` + auto-assigns a
   mechanic via `providerId`.
3. **Hand off to shop** — Tell the customer: "Got it — appointment requested for [time]. Our team
   will give it a final review and confirm shortly." The shop sees the complete package in the admin
   dashboard and clicks one button to confirm.

The customer's `schedule_order` call IS the affirmative consent — it's audited via the
`schedule_attached` event. There is no separate "approve" step.

## Available Tools

- `get_availability` — open slots for the next 7 days. Renders the date + time picker in the chat.
  **Do not** ask the customer for a preferred time before calling this — the picker IS the question.
- `schedule_order` — pin appointment time on an existing order.
  - Works on `draft` (chat path; status preserved, fields populated)
  - Works on `approved` (legacy path; auto-advances to `scheduled`)
  - Works on `scheduled` / `in_progress` (pure reschedule)
  - **Never pass `durationMinutesOverride`** — staff-only override; the customer-visible duration is
    fixed by the order's labor items.
- `cancel_booking` — customer cancels a `scheduled` appointment. Once status is `in_progress`
  (mechanic on the job), cancellations must go through the shop directly.
- `cancel_order` — customer aborts a `draft` (chat in progress, changed mind), `estimated`, or
  `scheduled` order.

## Auto-Dispatch Behavior

`schedule_order` triggers `autoAssignProvider()` after the time is set. The picker:

1. Eligible mechanics: `is_active=true` AND no `blocked_range` overlap
2. Customer-history preference: most recent `completed` order's mechanic (if eligible)
3. Round-robin fallback: eligible mechanic with fewest scheduled jobs in the next 7 days

If no mechanic is eligible (every active one busy at that exact slot), the order keeps
`providerId = null` and the shop dispatches manually. The tool's response message reflects this —
the agent should pass that through to the customer verbatim, not invent a mechanic name.

## Important Rules

- Never name the assigned mechanic to the customer — internal dispatch detail. The shop will
  introduce them.
- Never ask the customer to pick a mechanic — assignment is automatic.
- Never double-book. The harness's exclusion constraint prevents it; if `schedule_order` fails on
  conflict, call `get_availability` again and offer the updated slots.
- `schedule_order` does not currently take a service location from the customer side. If the address
  is non-default, the shop captures it during admin confirm.

## Service Area

Orange County only: Irvine, Newport Beach, Anaheim, Santa Ana, Costa Mesa, Fullerton, Huntington
Beach, Lake Forest, Mission Viejo.
