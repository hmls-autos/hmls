# Order Lifecycle Refactor — Implementation Plan (v2)

> Updated with fixes from code review. Changes from v1 marked with ⚠️.

## Problem Statement

The current order lifecycle has several structural issues:

1. **Estimate is immutable** — can't edit or revise after creation
2. **Three parallel status machines** — orders, quotes, and bookings each track status
   independently, leading to drift
3. **No revision flow** — when a customer declines, there's no way to modify and resend
4. **Inconsistent item models** — estimates use `{name, description, price}`, quotes use
   `{service, description, amount}`, bookings use `{name, partsNeeded, partsNote}`
5. **Missing validation** — expired estimates can still be approved, no pre-flight booking slot
   checks
6. **Fire-and-forget notifications** — email failures are silent

## Design Principles

- **Order is the single source of truth** for lifecycle state
- **Quotes and bookings are payload tables** — they hold data, not status
- **One item model** flows from estimate through invoice
- **Every transition is validated** before execution
- **Idempotent and auditable** — full event history
- **Atomic transitions** — read-check-write in a single DB transaction

---

## New Order Status Machine

```
draft ──→ estimated ──→ sent ──→ approved ──→ invoiced ──→ paid ──→ scheduled ──→ in_progress ──→ completed
  ↑           ↑           │                       │                                                    │
  └───────────┴── revised ←── declined             void                                             archived
                                                                    cancelled ←── (any non-terminal)
```

### Status Definitions

| Status        | Who triggers   | Description                                          |
| ------------- | -------------- | ---------------------------------------------------- |
| `draft`       | admin/system   | Estimate created but not finalized, editable         |
| `estimated`   | admin/system   | Estimate finalized with pricing, ready to send       |
| `sent`        | admin/system   | Estimate shared with customer (email/link sent)      |
| `approved`    | customer       | Customer approved estimate                           |
| `revised`     | admin          | Estimate modified after decline, goes back to `sent` |
| `declined`    | customer       | Customer declined (not terminal — can be revised)    |
| `invoiced`    | admin/system   | Stripe invoice/quote created and sent                |
| `paid`        | stripe webhook | Payment received                                     |
| `scheduled`   | admin          | Booking created with appointment                     |
| `in_progress` | admin          | Service started                                      |
| `completed`   | admin          | Service finished                                     |
| `archived`    | system         | Auto-archived after completion (30 days)             |
| `cancelled`   | admin/customer | Cancelled at any point (terminal)                    |
| `void`        | admin          | Invoice voided before payment (terminal)             |

### Transition Table

```typescript
const TRANSITIONS: Record<string, string[]> = {
  draft: ["estimated", "cancelled"],
  estimated: ["sent", "cancelled"],
  sent: ["approved", "declined", "cancelled"],
  approved: ["invoiced", "cancelled"],
  declined: ["revised"],
  revised: ["sent", "cancelled"],
  invoiced: ["paid", "void", "cancelled"],
  paid: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: ["archived"],
  // terminal states
  archived: [],
  cancelled: [],
  void: [],
};
```

### Key Changes from Current

| Current                        | New                              | Why                                        |
| ------------------------------ | -------------------------------- | ------------------------------------------ |
| `estimated` (first state)      | `draft` → `estimated`            | Allows editing before sending              |
| No `sent` state                | `sent` after sharing             | Know when customer was notified            |
| `customer_approved`            | `approved`                       | Simpler naming, actor tracked in history   |
| `customer_declined` (terminal) | `declined` (non-terminal)        | Enables revision flow                      |
| `quoted`                       | `invoiced`                       | Clearer semantics — maps to Stripe invoice |
| `accepted`                     | `paid`                           | Means what it says                         |
| Quote has own status           | No quote status                  | Order is source of truth                   |
| Booking has own status         | Booking status synced from order | No drift                                   |

---

## Unified Item Model

Replace three different item structures with one:

```typescript
interface OrderItem {
  id: string; // UUID, stable across revisions
  category: "labor" | "parts" | "fee" | "discount";
  name: string; // e.g. "Front Brake Pad Replacement"
  description?: string; // e.g. "OEM ceramic pads, includes hardware"
  quantity: number; // default 1
  unitPriceCents: number; // price per unit in cents
  totalCents: number; // quantity × unitPriceCents
  laborHours?: number; // for labor items
  partNumber?: string; // for parts items
  taxable: boolean; // default true
}
```

This model is used in:

- `orders.items` — the canonical items list
- Stripe invoice line items (generated from OrderItems)
- PDF estimate/invoice (rendered from OrderItems)
- Portal display (rendered from OrderItems)

Items currently on `estimates` table move to `orders` table directly.

---

## Phase 1: Schema Migration

### 1.1 Modify `orders` table

⚠️ **Fixed: SQL execution order** — status migration must check specific conditions BEFORE blanket
updates. Notes field included. Items JSONB converted to new format. CASCADE removed.

```sql
-- Add new columns
ALTER TABLE orders ADD COLUMN items JSONB DEFAULT '[]';
ALTER TABLE orders ADD COLUMN notes TEXT;
ALTER TABLE orders ADD COLUMN subtotal_cents INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN price_range_low_cents INTEGER;
ALTER TABLE orders ADD COLUMN price_range_high_cents INTEGER;
ALTER TABLE orders ADD COLUMN vehicle_info JSONB;
ALTER TABLE orders ADD COLUMN valid_days INTEGER DEFAULT 30;
ALTER TABLE orders ADD COLUMN expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN share_token VARCHAR(64);
ALTER TABLE orders ADD COLUMN revision_number INTEGER DEFAULT 1;
ALTER TABLE orders ADD COLUMN stripe_quote_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN stripe_invoice_id VARCHAR(255);

-- ⚠️ Remove ON DELETE CASCADE from estimate_id FK if present
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_estimate_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_estimate_id_fkey
  FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE SET NULL;

-- Migrate data from estimates (including notes)
UPDATE orders o SET
  items = (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'category', 'labor',
        'name', item->>'name',
        'description', COALESCE(item->>'description', ''),
        'quantity', 1,
        'unitPriceCents', (COALESCE((item->>'price')::numeric, 0) * 100)::integer,
        'totalCents', (COALESCE((item->>'price')::numeric, 0) * 100)::integer,
        'taxable', true
      )
    )
    FROM jsonb_array_elements(e.items) AS item
  ),
  notes = e.notes,
  subtotal_cents = COALESCE(e.subtotal, 0),
  price_range_low_cents = e.price_range_low,
  price_range_high_cents = e.price_range_high,
  vehicle_info = e.vehicle_info,
  valid_days = e.valid_days,
  expires_at = e.expires_at,
  share_token = e.share_token
FROM estimates e WHERE o.estimate_id = e.id;

-- Migrate Stripe IDs from quotes
UPDATE orders o SET
  stripe_quote_id = q.stripe_quote_id,
  stripe_invoice_id = q.stripe_invoice_id
FROM quotes q WHERE o.quote_id = q.id;

-- ⚠️ Fixed: Status migration — specific conditions FIRST, then blanket
-- 1. Orders with share_token that were sent to customer
UPDATE orders SET status = 'sent'
  WHERE status = 'estimated'
  AND share_token IS NOT NULL;
-- 2. Remaining estimated orders become draft
UPDATE orders SET status = 'draft'
  WHERE status = 'estimated';
-- 3. Other status renames
UPDATE orders SET status = 'approved' WHERE status = 'customer_approved';
UPDATE orders SET status = 'declined' WHERE status = 'customer_declined';
UPDATE orders SET status = 'invoiced' WHERE status = 'quoted';
UPDATE orders SET status = 'paid' WHERE status = 'accepted';
```

### 1.2 Update Drizzle schema

File: `apps/agent/src/db/schema.ts`

- Add new columns to `orders` table definition
- Keep `estimates` and `quotes` tables for backward compat (mark deprecated)
- Add `orderItems` type export

### 1.3 Add share_token index

```sql
CREATE UNIQUE INDEX idx_orders_share_token ON orders(share_token) WHERE share_token IS NOT NULL;
```

### 1.4 Create `order_events` table (audit log)

```sql
CREATE TABLE order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  event_type VARCHAR(50) NOT NULL,  -- 'status_change', 'items_edited', 'notification_sent', 'notification_failed'
  from_status VARCHAR(50),
  to_status VARCHAR(50),
  actor VARCHAR(100),  -- 'customer', 'admin:user@email', 'system', 'stripe'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_order_events_order_id ON order_events(order_id);
```

### Files to modify:

- `apps/agent/src/db/schema.ts` — add columns to orders, add OrderItem type, add order_events table
- `apps/agent/src/db/migrations/` — new migration file

---

## Phase 2: API Refactor

### 2.1 Order routes (`apps/gateway/src/routes/orders.ts`)

**Update TRANSITIONS table** to new state machine.

⚠️ **Fixed: Atomic transitions** — all status changes use
`UPDATE ... WHERE status = $current RETURNING *` to prevent race conditions. If no rows returned,
another request beat us.

```typescript
// Atomic transition pattern
const [updated] = await db.update(orders)
  .set({ status: newStatus, updatedAt: new Date() })
  .where(and(eq(orders.id, orderId), eq(orders.status, currentStatus)))
  .returning();
if (!updated) throw Errors.conflict("Order status changed concurrently");
```

**Add new endpoints:**

- `PATCH /api/admin/orders/:id` — edit order items, notes, vehicle info (only in `draft`,
  `estimated`, `revised`)
- `POST /api/admin/orders/:id/send` — transition to `sent`, trigger notification
- `POST /api/admin/orders/:id/revise` — create revision from declined order, bump revision_number
- `POST /api/admin/orders/:id/invoice` — create Stripe invoice from order items, transition to
  `invoiced`

**Update existing endpoints:**

- `PATCH /api/admin/orders/:id/status` — use new transitions table with atomic pattern
- Add validation: reject operations on expired orders

### 2.2 Estimate routes (`apps/gateway/src/routes/estimates.ts`)

**Deprecate** most endpoints. Redirect to order equivalents:

- `GET /api/estimates/:id/review` → read from orders table using share_token
- `POST /api/estimates/:id/approve` → `POST /api/orders/:id/approve` (by share_token) ⚠️ uses atomic
  transition
- `POST /api/estimates/:id/decline` → `POST /api/orders/:id/decline` (by share_token) ⚠️ uses atomic
  transition
- `GET /api/estimates/:id/pdf` → `GET /api/orders/:id/pdf`

### 2.3 Webhook routes (`apps/gateway/src/routes/webhook.ts`)

⚠️ **Fixed: Update ALL status string references atomically with code deployment.**

Update handlers:

- `quote.accepted` → transition order to `paid` (was `accepted`)
- `invoice.paid` → transition order to `paid`, store invoice ID on order ⚠️ (was silently doing
  nothing)
- `invoice.payment_failed` → log event, optionally transition to `void`
- Log all webhook events to `order_events` table

### 2.4 Portal routes (`apps/gateway/src/routes/portal.ts`)

Update to read from orders directly:

- `/api/portal/me/orders` — include items, vehicle info, pricing from orders table
- ⚠️ Keep `/api/portal/me/estimates` and `/api/portal/me/quotes` as thin redirects to orders
  (backward compat for cached clients)
- ⚠️ Update `canAct` logic: check for `sent` status (was `estimated`)

### 2.5 Admin revenue queries

⚠️ **Fixed: Revenue queries read from `orders` table** (was reading from `quotes` table which will
be empty after migration).

### Files to modify:

- `apps/gateway/src/routes/orders.ts` — major rewrite
- `apps/gateway/src/routes/estimates.ts` — deprecate, redirect
- `apps/gateway/src/routes/webhook.ts` — update status values + add invoice.paid handler
- `apps/gateway/src/routes/portal.ts` — simplify, update canAct
- `apps/gateway/src/routes/admin.ts` — remove estimate/quote CRUD, add order item editing, fix
  revenue queries

---

## Phase 3: Agent Tools

### 3.1 Update `create_estimate_tool`

- Write items directly to `orders.items` in new `OrderItem` format (with `unitPriceCents`,
  `totalCents`, `category`)
- Create order in `draft` status (was `estimated`)
- Still generate share_token, store on order
- Remove `estimates` INSERT

### 3.2 ⚠️ Update `get_estimate_tool` (was missing from v1)

- Read from `orders` table instead of `estimates`
- Return items in new format

### 3.3 Update `create_quote_tool`

- Rename to `create_invoice_tool`
- Read items from `orders.items` instead of taking separate input
- ⚠️ Match order by explicit `order_id` parameter, NOT by "oldest approved order"
- Create Stripe invoice from order items
- Store `stripe_quote_id` / `stripe_invoice_id` on order
- Transition order to `invoiced`
- Remove `quotes` INSERT

### 3.4 Update `create_booking_tool`

- Link booking to order via `orders.booking_id`
- Transition order to `scheduled` automatically
- Pre-validate slot availability before INSERT

### Files to modify:

- `apps/agent/src/hmls/skills/estimate/tools.ts` — rewrite create_estimate
- `apps/agent/src/hmls/tools/stripe.ts` — rewrite to create_invoice
- `apps/agent/src/hmls/tools/scheduling.ts` — add pre-validation, link to order
- ⚠️ Any file with `getEstimateTool` / `get_estimate` — update to read from orders

---

## Phase 4: Frontend (Admin + Portal)

⚠️ **Fixed execution order**: Build new orders UI FIRST, then delete old pages. Never leave admin
without a working interface.

### 4.1 Admin Orders page (`apps/hmls-web/app/admin/orders/page.tsx`)

**Major rewrite:**

- Show order items inline (expandable)
- Edit items when order is in `draft`/`estimated`/`revised`
- "Send to Customer" button (→ `sent`)
- "Create Invoice" button (→ `invoiced`)
- "Revise" button on declined orders
- Timeline view showing full status history (from `order_events`)
- ⚠️ Update `ORDER_STATUS` labels, `FILTER_OPTIONS`, and `ORDER_TRANSITIONS` to new states
- ⚠️ Update `ADMIN_NOTIFY_STATUSES` to new status names

### 4.2 ⚠️ THEN remove old pages (after 4.1 is working)

- Remove `apps/hmls-web/app/admin/estimates/page.tsx`
- Remove `apps/hmls-web/app/admin/quotes/page.tsx`
- ⚠️ Update admin nav/layout to remove dead links to deleted pages

### 4.3 Portal Orders page (`apps/hmls-web/app/portal/orders/page.tsx`)

- Show items and pricing from order directly
- ⚠️ Approve/Decline buttons for `sent` status (was checking `estimated`)
- Payment link for `invoiced` status
- Booking details for `scheduled`+
- ⚠️ Update portal layout nav — remove links to estimates/quotes pages

### 4.4 ⚠️ THEN remove old portal pages

- Remove `apps/hmls-web/app/portal/estimates/page.tsx`
- Remove `apps/hmls-web/app/portal/quotes/page.tsx`

### 4.5 Status labels (`apps/hmls-web/lib/status.ts`)

Update portal-facing and admin-facing labels for new states.

### 4.6 ⚠️ Fixo-web — NO portal changes needed

fixo-web does NOT have portal pages. Only hmls-web has portal/admin.

### Files to modify:

- `apps/hmls-web/app/admin/orders/page.tsx` — major rewrite
- `apps/hmls-web/app/admin/estimates/page.tsx` — remove (AFTER 4.1)
- `apps/hmls-web/app/admin/quotes/page.tsx` — remove (AFTER 4.1)
- `apps/hmls-web/app/admin/layout.tsx` — update nav links
- `apps/hmls-web/app/portal/orders/page.tsx` — simplify
- `apps/hmls-web/app/portal/estimates/page.tsx` — remove (AFTER 4.3)
- `apps/hmls-web/app/portal/quotes/page.tsx` — remove (AFTER 4.3)
- `apps/hmls-web/app/portal/layout.tsx` — update nav links
- `apps/hmls-web/lib/status.ts` — new states

---

## Phase 5: Notifications

### 5.1 Update email templates

⚠️ **Fixed: Update `STATUS_EMAILS` map keys to new status names.**

New/updated templates for:

- `sent` — "Your Estimate is Ready" (was keyed on `estimated`)
- `approved` — "Estimate Approved" (was keyed on `customer_approved`)
- `revised` — "We've Updated Your Estimate"
- `invoiced` — "Your Invoice is Ready" (was keyed on `quoted`)
- `paid` — "Payment Received" (was keyed on `accepted`)
- `void` — "Invoice Voided"

### 5.2 Add retry logic

- Wrap notification sending in 3-attempt retry with exponential backoff
- Log failures to `order_events` table

### 5.3 ⚠️ Update admin notification statuses

- `ADMIN_NOTIFY_STATUSES` array must use new status names

### Files to modify:

- `apps/agent/src/lib/notifications.ts` — update templates, status map keys, add retry

---

## Phase 6: Cleanup

### 6.1 Deprecate old tables

After migration is stable (1-2 weeks):

- Remove `estimates` table reads from all code
- Remove `quotes` table reads from all code
- Keep tables in DB for data reference
- Eventually drop tables after full verification

### 6.2 Remove dead code

- Old estimate/quote CRUD endpoints
- Old portal pages (already removed in Phase 4)
- Unused types and hooks

---

## Execution Order

⚠️ **Fixed: All code + webhook + notification changes deploy atomically with the schema migration.
No phased rollout with different status strings in flight.**

| Step | Phase             | What                                            | Risk                  | Dependencies |
| ---- | ----------------- | ----------------------------------------------- | --------------------- | ------------ |
| 1    | 1.1-1.4           | Schema migration + event table                  | High (data migration) | None         |
| 2    | 2.1-2.5 + 5.1-5.3 | API + webhook + notifications (ALL status refs) | Medium                | Step 1       |
| 3    | 3.1-3.4           | Agent tools                                     | Medium                | Step 1       |
| 4    | 4.1, 4.3, 4.5     | Frontend — build new pages                      | Low                   | Steps 2-3    |
| 5    | 4.2, 4.4          | Frontend — remove old pages + nav cleanup       | Low                   | Step 4       |
| 6    | 6.1-6.2           | Cleanup                                         | Low                   | All above    |

**Deploy strategy:** Steps 1-3 must be deployed together in a single deployment. You cannot have the
DB with new statuses and the code expecting old statuses (or vice versa).

**Total estimated files:** ~20 files modified, ~5 files deleted, ~3 new files

## ⚠️ Rollback Strategy (Revised)

The v1 plan proposed a feature flag — this doesn't work because the DB status values have already
changed. Revised approach:

1. **Before migration:** Take a full `pg_dump` backup of the database
2. **Schema migration is reversible** — write a `DOWN` migration that:
   - Renames statuses back (`approved` → `customer_approved`, etc.)
   - Drops added columns
3. **Deploy as a single atomic unit** — schema + code go live together
4. **If issues arise:**
   - Run the DOWN migration to revert status values
   - Deploy the previous git commit (old code)
5. **Keep `estimates` and `quotes` tables intact** — they're not modified, only read from during
   migration

## Testing Checklist

- [ ] Create order in `draft`, edit items, transition to `estimated`
- [ ] Send estimate to customer, verify email + share link
- [ ] Customer approves via share link → order moves to `approved`
- [ ] Customer declines → admin revises → resend → customer approves
- [ ] Create Stripe invoice → customer pays → order moves to `paid`
- [ ] Schedule booking → order moves to `scheduled`
- [ ] Full lifecycle: draft → estimated → sent → approved → invoiced → paid → scheduled →
      in_progress → completed
- [ ] Cancel at each stage → verify terminal state
- [ ] Void invoice before payment
- [ ] Expired estimate rejection
- [ ] Concurrent approve/decline race condition → only one succeeds
- [ ] Concurrent booking slot validation
- [ ] Notification delivery for each status transition
- [ ] Notification failure → logged to order_events, doesn't block transition
- [ ] Admin UI: edit items, transition buttons, timeline view
- [ ] Admin UI: filter by new statuses, revenue shows correctly
- [ ] Portal: approve/decline buttons show for `sent` status
- [ ] Portal: payment link for `invoiced`
- [ ] Portal: booking details for `scheduled`+
- [ ] PDF generation from new order items format
- [ ] Webhook handling: invoice.paid updates order status
- [ ] Items JSONB format: old `{name, description, price}` correctly converted to
      `{unitPriceCents, totalCents, category, ...}`
- [ ] Admin nav: no dead links after page removal
- [ ] Portal nav: no dead links after page removal
