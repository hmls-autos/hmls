# Appointment System Implementation Plan (v2 — Post-Audit)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Custom Supabase-backed appointment system with multi-mechanic support, overlap prevention
via `tstzrange` exclusion constraints, full work order capture, rich chat UI components, and a hero
quick-start widget. (Cal.com fully removed 2026-03-01.)

**Architecture:** Supabase tables (`providers`, `provider_availability`,
`provider_schedule_overrides`, `provider_services`, enhanced `bookings`) with a trigger-computed
`blocked_range` and GiST exclusion constraint. Agent tools (`get_availability`, `create_booking`)
handle scheduling. The frontend gets a hero booking widget, `SlotPicker`, and `BookingConfirmation`
chat components via `onToolCallResultEvent`. Guest booking supported with optional login auto-fill.

**Tech Stack:** Supabase PostgreSQL (tstzrange, btree_gist, exclusion constraints), Drizzle ORM +
raw SQL migrations, Deno/Hono API, Zod schemas, React 19 / Next.js 16 / Tailwind CSS 4 frontend,
AG-UI protocol.

**Design Doc:** `docs/plans/2026-02-22-appointment-system-design.md`

**Audit Fixes Applied:** C1-C5 (all critical), I1-I8 (all important), O1-O4 (all ordering), M1-M9
(all minor). See `Audit Changelog` at bottom.

---

### Task 1: Database Migration — Extension (Separate Transaction)

**Files:**

- Modify: `apps/api/src/db/migrate.ts`

**Why separate:** The `btree_gist` extension must be committed before the exclusion constraint can
reference it (audit C3).

**Step 1: Refactor migrate.ts to support multiple migration steps**

Change `migrate.ts` to run migrations as separate `await sql.unsafe()` calls instead of one big
string. Keep the existing `migrations` string as `migrationStep1`, and add `migrationStep2` for the
extension:

```typescript
// After the existing migrations string, add:
const migrationStep2 = `
CREATE EXTENSION IF NOT EXISTS btree_gist;
`;

async function migrate() {
  console.log("Running migrations...\n");
  try {
    console.log("Step 1: Core tables...");
    await sql.unsafe(migrations);
    console.log("Step 2: Extensions...");
    await sql.unsafe(migrationStep2);
    console.log("Migrations completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    Deno.exit(1);
  }
  await sql.end();
  Deno.exit(0);
}
```

**Step 2: Run and verify**

Run: `deno task --cwd apps/api db:migrate` Expected: "Migrations completed successfully!"

Verify via Supabase MCP `execute_sql`:

```sql
SELECT extname FROM pg_extension WHERE extname = 'btree_gist';
```

Expected: 1 row.

**Step 3: Commit**

```bash
git add apps/api/src/db/migrate.ts
git commit -m "feat(db): add btree_gist extension in separate migration step"
```

---

### Task 2: Database Migration — Provider Tables

**Files:**

- Modify: `apps/api/src/db/migrate.ts`

**Step 1: Add provider tables as `migrationStep3`**

```typescript
const migrationStep3 = `
-- Mechanic profiles
CREATE TABLE IF NOT EXISTS providers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  specialties JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  service_radius_miles INTEGER DEFAULT 30,
  home_base_lat NUMERIC(10, 7),
  home_base_lng NUMERIC(10, 7),
  timezone VARCHAR(50) NOT NULL DEFAULT 'America/Los_Angeles',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recurring weekly schedule per mechanic
CREATE TABLE IF NOT EXISTS provider_availability (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (start_time < end_time OR end_time = TIME '00:00:00'),
  UNIQUE (provider_id, day_of_week, start_time)
);

-- Date-specific overrides (vacations, holidays, special hours)
CREATE TABLE IF NOT EXISTS provider_schedule_overrides (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  override_date DATE NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT false,
  start_time TIME,
  end_time TIME,
  reason TEXT,
  UNIQUE (provider_id, override_date)
);

-- Which services each provider can perform
CREATE TABLE IF NOT EXISTS provider_services (
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, service_id)
);

-- RLS: block direct PostgREST access (all access through API)
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_services ENABLE ROW LEVEL SECURITY;
`;
```

Add to `migrate()`: `console.log("Step 3: Provider tables..."); await sql.unsafe(migrationStep3);`

**Step 2: Run and verify**

Run: `deno task --cwd apps/api db:migrate` Expected: "Migrations completed successfully!"

Verify:
`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'provider%' ORDER BY table_name;`
Expected: 4 rows.

**Step 3: Commit**

```bash
git add apps/api/src/db/migrate.ts
git commit -m "feat(db): add provider tables with RLS for appointment system"
```

---

### Task 3: Database Migration — Enhanced Bookings + Trigger + Constraint

**Files:**

- Modify: `apps/api/src/db/migrate.ts`

**Step 1: Add bookings enhancement as `migrationStep4`**

Key fixes from audit:

- Uses `scheduled_at` as appointment start (I1 — documented, not renamed)
- Trigger computes `appointment_end` and `blocked_range` from `scheduled_at + duration_minutes`
- Status constraint updated to include new statuses (I4)
- RLS enabled (I5)

```typescript
const migrationStep4 = `
-- Add new columns to existing bookings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'provider_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN provider_id INTEGER REFERENCES providers(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'service_items'
  ) THEN
    ALTER TABLE bookings ADD COLUMN service_items JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'symptom_description'
  ) THEN
    ALTER TABLE bookings ADD COLUMN symptom_description TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'vehicle_year'
  ) THEN
    ALTER TABLE bookings ADD COLUMN vehicle_year INTEGER;
    ALTER TABLE bookings ADD COLUMN vehicle_make VARCHAR(50);
    ALTER TABLE bookings ADD COLUMN vehicle_model VARCHAR(50);
    ALTER TABLE bookings ADD COLUMN vehicle_mileage INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'estimate_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN estimate_id INTEGER REFERENCES estimates(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'appointment_end'
  ) THEN
    ALTER TABLE bookings ADD COLUMN appointment_end TIMESTAMPTZ;
    ALTER TABLE bookings ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 60;
    ALTER TABLE bookings ADD COLUMN buffer_before_minutes INTEGER NOT NULL DEFAULT 30;
    ALTER TABLE bookings ADD COLUMN buffer_after_minutes INTEGER NOT NULL DEFAULT 15;
    ALTER TABLE bookings ADD COLUMN blocked_range TSTZRANGE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'location_lat'
  ) THEN
    ALTER TABLE bookings ADD COLUMN location_lat NUMERIC(10, 7);
    ALTER TABLE bookings ADD COLUMN location_lng NUMERIC(10, 7);
    ALTER TABLE bookings ADD COLUMN access_instructions TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'customer_name'
  ) THEN
    ALTER TABLE bookings ADD COLUMN customer_name VARCHAR(255);
    ALTER TABLE bookings ADD COLUMN customer_email VARCHAR(255);
    ALTER TABLE bookings ADD COLUMN customer_phone VARCHAR(20);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'photo_urls'
  ) THEN
    ALTER TABLE bookings ADD COLUMN photo_urls JSONB;
    ALTER TABLE bookings ADD COLUMN customer_notes TEXT;
    ALTER TABLE bookings ADD COLUMN internal_notes TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'preferred_mechanic_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN preferred_mechanic_id INTEGER REFERENCES providers(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE bookings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- Trigger: auto-compute blocked_range from scheduled_at + duration + buffers
-- NOTE: scheduled_at is the appointment start time (existing column name preserved)
CREATE OR REPLACE FUNCTION compute_blocked_range()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.scheduled_at IS NOT NULL AND NEW.duration_minutes IS NOT NULL THEN
    NEW.appointment_end := NEW.scheduled_at + make_interval(mins => NEW.duration_minutes);
    NEW.blocked_range := tstzrange(
      NEW.scheduled_at - make_interval(mins => NEW.buffer_before_minutes),
      NEW.appointment_end + make_interval(mins => NEW.buffer_after_minutes),
      '[)'
    );
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compute_blocked_range ON bookings;
CREATE TRIGGER trg_compute_blocked_range
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION compute_blocked_range();

-- RLS on bookings (block direct PostgREST access)
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
`;
```

**Step 2: Add exclusion constraint as `migrationStep5` (separate transaction — needs btree_gist
committed)**

```typescript
const migrationStep5 = `
-- Exclusion constraint: no overlapping bookings per provider
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_no_overlap
      EXCLUDE USING gist (
        provider_id WITH =,
        blocked_range WITH &&
      ) WHERE (
        status NOT IN ('cancelled', 'no_show')
        AND provider_id IS NOT NULL
        AND blocked_range IS NOT NULL
      );
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bookings_provider_time
  ON bookings USING gist (provider_id, blocked_range)
  WHERE status NOT IN ('cancelled', 'no_show') AND provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_customer
  ON bookings (customer_id, scheduled_at DESC);
`;
```

Add both to `migrate()`:

```
console.log("Step 4: Enhanced bookings...");
await sql.unsafe(migrationStep4);
console.log("Step 5: Exclusion constraint + indexes...");
await sql.unsafe(migrationStep5);
```

**Step 3: Run and verify**

Run: `deno task --cwd apps/api db:migrate`

Verify trigger + constraint:

```sql
SELECT tgname FROM pg_trigger WHERE tgrelid = 'bookings'::regclass AND tgname = 'trg_compute_blocked_range';
SELECT conname FROM pg_constraint WHERE conrelid = 'bookings'::regclass AND conname = 'bookings_no_overlap';
```

Expected: Both return 1 row.

**Step 4: Commit**

```bash
git add apps/api/src/db/migrate.ts
git commit -m "feat(db): add enhanced bookings with tstzrange overlap prevention and RLS"
```

---

### Task 4: Drizzle Schema Update

**Files:**

- Modify: `apps/api/src/db/schema.ts`

**Audit fixes:** M1 (use native time type note), M2 (composite PK for providerServices), I1
(document scheduled_at = appointment start).

**Step 1: Add imports, custom type, and provider tables**

Add `customType` import and `primaryKey` import:

```typescript
import { customType, primaryKey } from "drizzle-orm/pg-core";
```

Add `tstzrange` custom type:

```typescript
const tstzrange = customType<{ data: string; driverParam: string }>({
  dataType() {
    return "tstzrange";
  },
});
```

Add provider tables after `customers`:

```typescript
export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  specialties: jsonb("specialties"),
  isActive: boolean("is_active").notNull().default(true),
  serviceRadiusMiles: integer("service_radius_miles").default(30),
  homeBaseLat: numeric("home_base_lat", { precision: 10, scale: 7 }),
  homeBaseLng: numeric("home_base_lng", { precision: 10, scale: 7 }),
  timezone: varchar("timezone", { length: 50 }).notNull().default("America/Los_Angeles"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providerAvailability = pgTable("provider_availability", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" })
    .notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  // Stored as TIME in DB; varchar here because Drizzle returns TIME as string
  startTime: varchar("start_time", { length: 8 }).notNull(),
  endTime: varchar("end_time", { length: 8 }).notNull(),
});

export const providerScheduleOverrides = pgTable("provider_schedule_overrides", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" })
    .notNull(),
  overrideDate: varchar("override_date", { length: 10 }).notNull(),
  isAvailable: boolean("is_available").notNull().default(false),
  startTime: varchar("start_time", { length: 8 }),
  endTime: varchar("end_time", { length: 8 }),
  reason: text("reason"),
});

export const providerServices = pgTable("provider_services", {
  providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" })
    .notNull(),
  serviceId: integer("service_id").references(() => services.id, { onDelete: "cascade" }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.providerId, table.serviceId] }),
}));
```

**Step 2: Replace the existing `bookings` table definition**

```typescript
// NOTE: `scheduledAt` maps to `scheduled_at` — this IS the appointment start time.
// Column was not renamed to preserve backwards compatibility with existing data.
export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customers.id),
  providerId: integer("provider_id").references(() => providers.id),
  serviceType: varchar("service_type", { length: 100 }).notNull(),
  serviceItems: jsonb("service_items").notNull().default([]),
  symptomDescription: text("symptom_description"),
  vehicleYear: integer("vehicle_year"),
  vehicleMake: varchar("vehicle_make", { length: 50 }),
  vehicleModel: varchar("vehicle_model", { length: 50 }),
  vehicleMileage: integer("vehicle_mileage"),
  estimateId: integer("estimate_id").references(() => estimates.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  appointmentEnd: timestamp("appointment_end", { withTimezone: true }),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(30),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(15),
  blockedRange: tstzrange("blocked_range"),
  location: text("location"),
  locationLat: numeric("location_lat", { precision: 10, scale: 7 }),
  locationLng: numeric("location_lng", { precision: 10, scale: 7 }),
  accessInstructions: text("access_instructions"),
  customerName: varchar("customer_name", { length: 255 }),
  customerEmail: varchar("customer_email", { length: 255 }),
  customerPhone: varchar("customer_phone", { length: 20 }),
  photoUrls: jsonb("photo_urls"),
  customerNotes: text("customer_notes"),
  internalNotes: text("internal_notes"),
  preferredMechanicId: integer("preferred_mechanic_id").references(() => providers.id),
  status: varchar("status", { length: 50 }).notNull().default("requested"),
  // calcom_booking_id removed 2026-03-01
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

**Step 3: Verify**

Run: `deno task check:api` Expected: No errors.

**Step 4: Commit**

```bash
git add apps/api/src/db/schema.ts
git commit -m "feat(db): add Drizzle schema for providers and enhanced bookings"
```

---

### Task 5: Seed Data — Provider + Schedule

**Files:**

- Create: `apps/api/src/db/seed-data/providers.json`
- Modify: `apps/api/src/db/seed.ts`

**Audit fix C5:** Use `"24:00"` for midnight end time. PostgreSQL TIME accepts `24:00:00`.

**Step 1: Create `apps/api/src/db/seed-data/providers.json`**

```json
[
  {
    "name": "Spencer",
    "email": "business@hmls.autos",
    "phone": "+19492137073",
    "specialties": ["brakes", "engine", "electrical", "suspension", "ac", "maintenance"],
    "isActive": true,
    "serviceRadiusMiles": 30,
    "timezone": "America/Los_Angeles",
    "schedule": [
      { "dayOfWeek": 1, "startTime": "08:00", "endTime": "24:00" },
      { "dayOfWeek": 2, "startTime": "08:00", "endTime": "24:00" },
      { "dayOfWeek": 3, "startTime": "08:00", "endTime": "24:00" },
      { "dayOfWeek": 4, "startTime": "08:00", "endTime": "24:00" },
      { "dayOfWeek": 5, "startTime": "08:00", "endTime": "24:00" },
      { "dayOfWeek": 6, "startTime": "09:00", "endTime": "14:00" }
    ],
    "allServices": true
  }
]
```

**Step 2: Update `apps/api/src/db/seed.ts`**

Add import, cleanup, and seeding logic (see original plan Task 4 for code). Key addition: add
cleanup for provider tables at top of `seed()` before existing clears, and add provider seeding
after vehicle pricing.

**Step 3: Run and verify**

Run: `deno task --cwd apps/api db:seed` Expected: Provider seeded with 6 schedule slots.

**Step 4: Commit**

```bash
git add apps/api/src/db/seed-data/providers.json apps/api/src/db/seed.ts
git commit -m "feat(db): add provider seed data with schedule and service links"
```

---

### Task 6: Update System Prompt — Work Order Flow (Moved Before Tools — O3)

**Files:**

- Modify: `apps/api/src/system-prompt.ts`

**Why moved here:** Audit O3 — system prompt must be updated before building tools, so the agent
uses the correct workflow during testing.

**Step 1: Replace the "Booking Appointments" section**

Replace with the work order flow (see original plan Task 8 for full text). Key additions from audit:

- Add to prompt: "If no slots are available, apologize and ask the customer to call us at (949)
  213-7073."
- Add: "For authenticated customers, the system will automatically link your customer_id. For
  guests, collect name, email, and phone before booking."
- Cal.com references removed (2026-03-01).

**Step 2: Verify**

Run: `deno task check:api` Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/system-prompt.ts
git commit -m "feat(api): update system prompt with work order booking flow"
```

---

### Task 7: Agent Tool — `get_availability` (With Audit Fixes)

**Files:**

- Create: `apps/api/src/tools/scheduling.ts`

**Audit fixes applied:**

- **C1:** Pass `serviceDurationMinutes` to `discretizeSlots`, not `totalBlockedMinutes`. Free ranges
  already subtract `blocked_range` (which includes buffers).
- **C2:** Timezone-aware timestamp construction using provider timezone.
- **I3:** Batch all bookings in one query, group in memory.
- **I6:** Guard against zero-increment infinite loop.
- **M8:** Use `lte` for endDate override query (include end date).

**Step 1: Create `apps/api/src/tools/scheduling.ts`**

Key differences from original plan:

```typescript
// FIXED (C1): Pass serviceDurationMinutes, NOT totalBlockedMinutes
const daySlots = discretizeSlots(freeRanges, serviceDurationMinutes);

// FIXED (C2): Timezone-aware timestamp construction
function toProviderTimestamp(dateStr: string, timeStr: string, tz: string): Date {
  // Handle "24:00" as next day midnight
  if (timeStr === "24:00") {
    const nextDay = new Date(dateStr);
    nextDay.setDate(nextDay.getDate() + 1);
    return toProviderTimestamp(nextDay.toISOString().split("T")[0], "00:00", tz);
  }
  // Construct a date string and use the timezone to get correct UTC offset
  const naive = new Date(`${dateStr}T${timeStr}:00`);
  // Get the UTC offset for this timezone on this date
  const utcStr = naive.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = naive.toLocaleString("en-US", { timeZone: tz });
  const diffMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();
  return new Date(naive.getTime() + diffMs);
}

// FIXED (I3): Batch query all bookings for all providers in date range
const allBookings = await db.execute(
  sql`SELECT provider_id, blocked_range FROM bookings
      WHERE provider_id = ANY(${sql.raw(`ARRAY[${providerIds.join(",")}]`)})
      AND status NOT IN ('cancelled', 'no_show')
      AND blocked_range IS NOT NULL
      AND blocked_range && tstzrange(
        ${rangeStart.toISOString()}::timestamptz,
        ${rangeEnd.toISOString()}::timestamptz, '[)')
      ORDER BY provider_id, scheduled_at`
);
// Group by provider_id in memory, then use per-provider in the loop

// FIXED (I6): Guard in discretizeSlots
function discretizeSlots(
  freeRanges: Array<{ start: Date; end: Date }>,
  serviceDurationMinutes: number,
  slotIncrementMinutes = 30,
): string[] {
  if (slotIncrementMinutes <= 0) slotIncrementMinutes = 30;
  const slots: string[] = [];
  for (const range of freeRanges) {
    let cursor = range.start.getTime();
    while (cursor + serviceDurationMinutes * 60_000 <= range.end.getTime()) {
      slots.push(new Date(cursor).toISOString());
      cursor += slotIncrementMinutes * 60_000;
    }
  }
  return slots;
}

// FIXED (M8): Use lte for endDate override query
lte(schema.providerScheduleOverrides.overrideDate, endDate),
```

Also add: if no providers found and no slots, return a `message` field: "No availability found.
Please call us at (949) 213-7073."

**Step 2: Verify**

Run: `deno task check:api` Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/tools/scheduling.ts
git commit -m "feat(api): add get_availability tool with tz-aware slot computation"
```

---

### Task 8: Agent Tool — `create_booking` + Customer Linking (With Audit Fixes)

**Files:**

- Modify: `apps/api/src/tools/scheduling.ts`

**Audit fixes:**

- **I2:** Accept `customerId` parameter (passed by the chat route from auth context). For guests,
  upsert customer from email.
- **I7:** Actually create/link customer record for guests.

**Step 1: Add `create_booking` tool**

Key differences from original plan:

```typescript
// Tool schema includes customerId (populated by chat route, not by AI):
customerId: z.number().optional().describe(
  "INTERNAL: customer ID from auth context. Do not ask the customer for this."
),

// In execute():
// 1. If customerId provided (authenticated), use it directly
// 2. If guest (no customerId), upsert customer from email
let resolvedCustomerId = params.customerId ?? null;
if (!resolvedCustomerId && params.customerEmail) {
  const [existing] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.email, params.customerEmail))
    .limit(1);
  if (existing) {
    resolvedCustomerId = existing.id;
  } else {
    const [created] = await db
      .insert(schema.customers)
      .values({
        name: params.customerName || null,
        email: params.customerEmail,
        phone: params.customerPhone || null,
      })
      .returning();
    resolvedCustomerId = created.id;
  }
}

// Insert with customerId
const [booking] = await db.insert(schema.bookings).values({
  customerId: resolvedCustomerId,
  providerId: params.providerId,
  // ... rest of fields
}).returning();
```

**Step 2: Verify**

Run: `deno task check:api` Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/tools/scheduling.ts
git commit -m "feat(api): add create_booking tool with customer linking and overlap protection"
```

---

### Task 9: Wire Agent — Completed (Cal.com removed 2026-03-01)

Cal.com integration (`calcom.ts`, env vars, AgentConfig fields) fully removed. Scheduling tools
wired directly.

---

### Task 10: Chat UI Components — SlotPicker + BookingConfirmation

**Files:**

- Create: `apps/web/components/SlotPicker.tsx`
- Create: `apps/web/components/BookingConfirmation.tsx`

**Step 1-2:** Create both components (same code as original plan Tasks 9-10).

**Audit fix M7:** Export the data interfaces so they can be imported in the hook (avoid `as any`):

```typescript
// In SlotPicker.tsx:
export type { SlotPickerData };

// In BookingConfirmation.tsx:
export type { BookingConfirmationData };
```

**Step 3: Verify**

Run: `cd apps/web && bun run typecheck` Expected: No errors.

**Step 4: Commit**

```bash
git add apps/web/components/SlotPicker.tsx apps/web/components/BookingConfirmation.tsx
git commit -m "feat(web): add SlotPicker and BookingConfirmation chat components"
```

---

### Task 11: Wire Chat UI — Tool Result Interception (With Audit Fixes)

**Files:**

- Modify: `apps/web/hooks/useAgentChat.ts`
- Modify: `apps/web/app/chat/page.tsx`

**Audit fixes:**

- **C4:** Use `onToolCallResultEvent` (not `onToolCallEndEvent`) to get tool output. Field is
  `event.content` (string). Correlate with tool name via `toolCallId` tracking.
- **M6:** Wrap booking confirmations in `AnimatePresence`.
- **M7:** Use exported types instead of `as any`.

**Step 1: Update useAgentChat.ts**

Key changes:

```typescript
import type { SlotPickerData } from "@/components/SlotPicker";
import type { BookingConfirmationData } from "@/components/BookingConfirmation";

// Track tool call names by ID for correlating results
const toolCallNamesRef = useRef<Map<string, string>>(new Map());

const [pendingSlotPicker, setPendingSlotPicker] = useState<SlotPickerData | null>(null);
const [bookingConfirmations, setBookingConfirmations] = useState<
  Array<{ id: string; data: BookingConfirmationData }>
>([]);

// In onToolCallStartEvent: track the tool name by ID
onToolCallStartEvent: ({ event }) => {
  setCurrentTool(event.toolCallName);
  toolCallNamesRef.current.set(event.toolCallId, event.toolCallName);
},

// onToolCallEndEvent: keep existing ask_user_question interception
onToolCallEndEvent: ({ toolCallName, toolCallArgs }) => {
  if (toolCallName === "ask_user_question") {
    setPendingQuestion(toolCallArgs as QuestionData);
  }
  setCurrentTool(null);
},

// NEW: onToolCallResultEvent — intercept tool outputs
onToolCallResultEvent: ({ event }) => {
  const toolName = toolCallNamesRef.current.get(event.toolCallId);
  if (!toolName || !event.content) return;

  try {
    const result = JSON.parse(event.content);
    if (toolName === "get_availability") {
      setPendingSlotPicker(result as SlotPickerData);
    }
    if (toolName === "create_booking" && result.success !== undefined) {
      setBookingConfirmations((prev) => [
        ...prev,
        { id: crypto.randomUUID(), data: result as BookingConfirmationData },
      ]);
    }
  } catch { /* ignore parse errors */ }
},
```

Add `selectSlot` callback and update `clearMessages` (same as original).

**Step 2: Update chat/page.tsx**

Import and wire components. Use typed props (no `as any`):

```tsx
{
  pendingSlotPicker && (
    <SlotPicker data={pendingSlotPicker} onSelect={selectSlot} disabled={isLoading} />
  );
}

<AnimatePresence>
  {bookingConfirmations.map((bc) => <BookingConfirmation key={bc.id} data={bc.data} />)}
</AnimatePresence>;
```

**Step 3: Verify**

Run: `cd apps/web && bun run typecheck && bun run build` Expected: No errors.

**Step 4: Commit**

```bash
git add apps/web/hooks/useAgentChat.ts apps/web/app/chat/page.tsx
git commit -m "feat(web): wire tool result interception for SlotPicker and BookingConfirmation"
```

---

### Task 12: Guest Chat Access + Hero Widget + Query Params (Merged — O4)

**Files:**

- Modify: `apps/web/app/chat/page.tsx` (remove login wall, add query params)
- Create: `apps/web/components/BookingWidget.tsx`
- Modify: `apps/web/components/sections/HeroNew.tsx`

**Audit fix O4:** Merge guest access and hero widget into one task — the widget navigates to `/chat`
which must already be guest-accessible.

**Audit fix M4:** Use actual service names as query param values (not slugified). The agent matches
against DB names.

**Audit fix M5:** Wrap chat page in `<Suspense>` for `useSearchParams()`.

**Step 1: Remove login wall in chat/page.tsx**

Remove the `if (!user)` block that returns a login prompt. Let all users (guest + authenticated)
access the chat. If authenticated, `accessToken` is passed to the agent; if not, it's `undefined`
(already handled).

**Step 2: Add query param reading**

```typescript
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

// Inside the component:
const searchParams = useSearchParams();
const hasSentInitial = useRef(false);

useEffect(() => {
  if (hasSentInitial.current || messages.length > 0) return;
  const service = searchParams.get("service");
  const date = searchParams.get("date");
  const location = searchParams.get("location");

  if (service || date || location) {
    hasSentInitial.current = true;
    const parts: string[] = [];
    if (service) parts.push(`I need ${/^[aeiou]/i.test(service) ? "an" : "a"} ${service}`);
    if (date) {
      const formatted = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      parts.push(`on ${formatted}`);
    }
    if (location) parts.push(`near ${location}`);
    sendMessage(parts.join(" ") + ".");
  }
}, [searchParams, messages.length, sendMessage]);

// Wrap the export in Suspense:
export default function ChatPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ChatPageInner />
    </Suspense>
  );
}
```

**Step 3: Create BookingWidget.tsx**

Use actual service names as values (M4 fix):

```typescript
const services = [
  { value: "Oil Change", label: "Oil Change" },
  { value: "Brake Service", label: "Brake Service" },
  { value: "Battery & Electrical", label: "Battery & Electrical" },
  { value: "Engine Diagnostics", label: "Engine Diagnostics" },
  { value: "A/C Service", label: "A/C Service" },
  { value: "Suspension", label: "Suspension" },
];
```

**Step 4: Update HeroNew.tsx**

Import and render `<BookingWidget />` replacing the CTA buttons.

**Step 5: Verify**

Run: `cd apps/web && bun run lint && bun run typecheck && bun run build` Expected: No errors.

**Step 6: Commit**

```bash
git add apps/web/app/chat/page.tsx apps/web/components/BookingWidget.tsx apps/web/components/sections/HeroNew.tsx
git commit -m "feat(web): add hero booking widget, guest chat access, and query param seeding"
```

---

### Task 13: Full CI Validation + Smoke Test

**Files:** None (verification only)

**Step 1: Run full CI suite**

```bash
cd apps/web && bun run lint
cd apps/web && bun run typecheck
cd apps/web && bun run build
deno task check:api
deno task check:diagnostic
```

**Step 2: Run migration + seed**

```bash
deno task --cwd apps/api db:migrate
deno task --cwd apps/api db:seed
```

**Step 3: Verify Supabase security**

Run `get_advisors` for security — verify RLS is enabled on all new tables.

**Step 4: Smoke test**

1. Start dev servers
2. Verify hero widget on homepage
3. Fill in widget, click "Book Now" → navigates to `/chat?...`
4. Chat auto-sends initial message
5. Full booking flow — agent gathers details, calls `get_availability`
6. Verify SlotPicker renders with available times
7. Select a slot, complete the flow
8. Verify BookingConfirmation card renders
9. Test as guest (not logged in) — should work without login wall

---

## Audit Changelog

| ID     | Issue                                       | Fix Applied                                                                         |
| ------ | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| **C1** | `discretizeSlots` double-counts buffers     | Pass `serviceDurationMinutes` only; free ranges already buffer-aware                |
| **C2** | Timezone-naive timestamps                   | Added `toProviderTimestamp()` using provider timezone                               |
| **C3** | btree_gist + constraint same transaction    | Split into separate migration steps                                                 |
| **C4** | Wrong AG-UI event for tool results          | Use `onToolCallResultEvent` with `event.content`; track tool names via `toolCallId` |
| **C5** | `23:59` end time truncates midnight         | Use `24:00` (PostgreSQL accepts it)                                                 |
| **I1** | `scheduled_at` vs `appointmentStart` naming | Documented in schema comments; not renamed                                          |
| **I2** | No `customer_id` for authenticated users    | `create_booking` accepts `customerId` from auth context                             |
| **I3** | N+1 queries in `get_availability`           | Single batch query, group in memory                                                 |
| **I4** | Missing status constraint update            | Added status check in migration                                                     |
| **I5** | No RLS on new tables                        | `ENABLE ROW LEVEL SECURITY` on all new tables                                       |
| **I6** | No zero-increment guard                     | Added `if (slotIncrementMinutes <= 0)` guard                                        |
| **I7** | Guest customer record not created           | Guest upsert logic added to `create_booking`                                        |
| **I8** | Singular `pendingSlotPicker` overwritten    | Documented: latest result shown; acceptable for v1                                  |
| **M1** | `varchar` for TIME columns                  | Documented: Drizzle returns TIME as string                                          |
| **M2** | Missing composite PK                        | Added `primaryKey({ columns: [...] })`                                              |
| **M4** | Hardcoded service slugs                     | Use actual DB service names as values                                               |
| **M5** | Missing Suspense boundary                   | Wrap chat page in `<Suspense>`                                                      |
| **M6** | Missing AnimatePresence on confirmations    | Added                                                                               |
| **M7** | `as any` type assertions                    | Export and use typed interfaces                                                     |
| **M8** | `lt` instead of `lte` for override end date | Changed to `lte`                                                                    |
| **M9** | Task 14 redundant after Task 7              | Merged into Task 9                                                                  |
| **O1** | Delete calcom.ts too late                   | Completed — removed 2026-03-01                                                      |
| **O3** | System prompt after tools                   | Moved to Task 6 (before tools)                                                      |
| **O4** | Guest access after hero widget              | Merged into Task 12                                                                 |
