# Appointment System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Custom Supabase-backed appointment system with multi-mechanic support, overlap prevention via `tstzrange` exclusion constraints, full work order capture, rich chat UI components, and a hero quick-start widget. (Cal.com fully removed 2026-03-01.)

**Architecture:** Supabase tables (`providers`, `provider_availability`, `provider_schedule_overrides`, `provider_services`, enhanced `bookings`) with a trigger-computed `blocked_range` and GiST exclusion constraint. Agent tools (`get_availability`, `create_booking`) handle scheduling. The frontend gets a hero booking widget, `SlotPicker`, and `BookingConfirmation` chat components. Guest booking supported with optional login auto-fill.

**Tech Stack:** Supabase PostgreSQL (tstzrange, btree_gist, exclusion constraints), Drizzle ORM + raw SQL migrations, Deno/Hono API, Zod schemas, React 19 / Next.js 16 / Tailwind CSS 4 frontend, AG-UI protocol.

**Design Doc:** `docs/plans/2026-02-22-appointment-system-design.md`

---

### Task 1: Database Migration — Extension + Provider Tables

**Files:**
- Modify: `apps/api/src/db/migrate.ts` (append new migration SQL)

**Step 1: Add the btree_gist extension and provider tables to the migration file**

Append this SQL to the `migrations` string in `apps/api/src/db/migrate.ts`, after the existing `invoices` table:

```sql
-- ══════════════════════════════════════════════════════════════
-- Appointment System: Provider tables
-- ══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;

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
  CHECK (start_time < end_time),
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
```

**Step 2: Run the migration**

Run: `deno task --cwd apps/api db:migrate`
Expected: "Migrations completed successfully!"

**Step 3: Verify tables exist**

Run the Supabase MCP `execute_sql` tool:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('providers', 'provider_availability', 'provider_schedule_overrides', 'provider_services')
ORDER BY table_name;
```
Expected: 4 rows returned.

**Step 4: Commit**

```bash
git add apps/api/src/db/migrate.ts
git commit -m "feat(db): add provider tables for appointment system"
```

---

### Task 2: Database Migration — Enhanced Bookings Table

**Files:**
- Modify: `apps/api/src/db/migrate.ts` (append bookings migration)

**Step 1: Add the bookings enhancement migration**

Append this SQL to `migrations` in `apps/api/src/db/migrate.ts`, after the provider tables from Task 1:

```sql
-- ══════════════════════════════════════════════════════════════
-- Appointment System: Enhanced bookings (work orders)
-- ══════════════════════════════════════════════════════════════

-- Add new columns to existing bookings table
DO $$
BEGIN
  -- provider_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'provider_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN provider_id INTEGER REFERENCES providers(id);
  END IF;

  -- Service details
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

  -- Vehicle info
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'vehicle_year'
  ) THEN
    ALTER TABLE bookings ADD COLUMN vehicle_year INTEGER;
    ALTER TABLE bookings ADD COLUMN vehicle_make VARCHAR(50);
    ALTER TABLE bookings ADD COLUMN vehicle_model VARCHAR(50);
    ALTER TABLE bookings ADD COLUMN vehicle_mileage INTEGER;
  END IF;

  -- Estimate reference
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'estimate_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN estimate_id INTEGER REFERENCES estimates(id);
  END IF;

  -- Scheduling: appointment_end + buffer + blocked_range
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

  -- Location details
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'location_lat'
  ) THEN
    ALTER TABLE bookings ADD COLUMN location_lat NUMERIC(10, 7);
    ALTER TABLE bookings ADD COLUMN location_lng NUMERIC(10, 7);
    ALTER TABLE bookings ADD COLUMN access_instructions TEXT;
  END IF;

  -- Guest customer info
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'customer_name'
  ) THEN
    ALTER TABLE bookings ADD COLUMN customer_name VARCHAR(255);
    ALTER TABLE bookings ADD COLUMN customer_email VARCHAR(255);
    ALTER TABLE bookings ADD COLUMN customer_phone VARCHAR(20);
  END IF;

  -- Media + notes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'photo_urls'
  ) THEN
    ALTER TABLE bookings ADD COLUMN photo_urls JSONB;
    ALTER TABLE bookings ADD COLUMN customer_notes TEXT;
    ALTER TABLE bookings ADD COLUMN internal_notes TEXT;
  END IF;

  -- Mechanic preference
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'preferred_mechanic_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN preferred_mechanic_id INTEGER REFERENCES providers(id);
  END IF;

  -- Updated_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE bookings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- Trigger: auto-compute blocked_range from appointment times + buffers
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

-- Exclusion constraint: no overlapping bookings per provider
-- Only applies to rows with a provider_id and blocked_range (new bookings)
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
      ) WHERE (status NOT IN ('cancelled', 'no_show') AND provider_id IS NOT NULL AND blocked_range IS NOT NULL);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bookings_provider_time
  ON bookings USING gist (provider_id, blocked_range)
  WHERE status NOT IN ('cancelled', 'no_show') AND provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_customer
  ON bookings (customer_id, scheduled_at DESC);

-- Update status check constraint to include new statuses
-- (Drop old constraint if it exists, add new one)
DO $$
BEGIN
  -- calcom_booking_id column dropped 2026-03-01
  NULL;
END $$;
```

**Note:** We use `scheduled_at` (the existing column) as the appointment start time rather than renaming it to `appointment_start`. This avoids breaking existing data. The trigger computes `appointment_end` and `blocked_range` from `scheduled_at + duration_minutes`.

**Step 2: Run the migration**

Run: `deno task --cwd apps/api db:migrate`
Expected: "Migrations completed successfully!"

**Step 3: Verify the trigger and constraint**

Run via Supabase MCP `execute_sql`:
```sql
SELECT tgname FROM pg_trigger WHERE tgrelid = 'bookings'::regclass AND tgname = 'trg_compute_blocked_range';
SELECT conname FROM pg_constraint WHERE conrelid = 'bookings'::regclass AND conname = 'bookings_no_overlap';
```
Expected: Both return 1 row.

**Step 4: Commit**

```bash
git add apps/api/src/db/migrate.ts
git commit -m "feat(db): add enhanced bookings with tstzrange overlap prevention"
```

---

### Task 3: Drizzle Schema Update

**Files:**
- Modify: `apps/api/src/db/schema.ts` (add provider tables, update bookings)

**Step 1: Add provider table definitions and update bookings in schema.ts**

Add imports at the top of `apps/api/src/db/schema.ts`:
```typescript
import { customType } from "drizzle-orm/pg-core";
```

Add the `tstzrange` custom type (Drizzle doesn't support it natively):
```typescript
const tstzrange = customType<{ data: string; driverParam: string }>({
  dataType() {
    return "tstzrange";
  },
});
```

Add provider tables after the existing `customers` table:

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
  providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" }).notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: varchar("start_time", { length: 8 }).notNull(),
  endTime: varchar("end_time", { length: 8 }).notNull(),
});

export const providerScheduleOverrides = pgTable("provider_schedule_overrides", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" }).notNull(),
  overrideDate: varchar("override_date", { length: 10 }).notNull(),
  isAvailable: boolean("is_available").notNull().default(false),
  startTime: varchar("start_time", { length: 8 }),
  endTime: varchar("end_time", { length: 8 }),
  reason: text("reason"),
});

export const providerServices = pgTable("provider_services", {
  providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" }).notNull(),
  serviceId: integer("service_id").references(() => services.id, { onDelete: "cascade" }).notNull(),
});
```

Update the `bookings` table to include new columns:

```typescript
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

**Step 2: Verify types compile**

Run: `deno task check:api`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/db/schema.ts
git commit -m "feat(db): add Drizzle schema for providers and enhanced bookings"
```

---

### Task 4: Seed Data — Initial Provider + Schedule

**Files:**
- Create: `apps/api/src/db/seed-data/providers.json`
- Modify: `apps/api/src/db/seed.ts` (add provider seeding)

**Step 1: Create provider seed data**

Create `apps/api/src/db/seed-data/providers.json`:

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
      { "dayOfWeek": 1, "startTime": "08:00", "endTime": "23:59" },
      { "dayOfWeek": 2, "startTime": "08:00", "endTime": "23:59" },
      { "dayOfWeek": 3, "startTime": "08:00", "endTime": "23:59" },
      { "dayOfWeek": 4, "startTime": "08:00", "endTime": "23:59" },
      { "dayOfWeek": 5, "startTime": "08:00", "endTime": "23:59" },
      { "dayOfWeek": 6, "startTime": "09:00", "endTime": "14:00" }
    ],
    "allServices": true
  }
]
```

**Step 2: Add provider seeding logic to seed.ts**

Add to `apps/api/src/db/seed.ts` — import the provider data and add seeding after the existing vehicle pricing seed:

```typescript
import providersRaw from "./seed-data/providers.json" with { type: "json" };

// In seed() function, after vehicle pricing:

// Seed providers
console.log(`Inserting ${providersRaw.length} providers...`);
for (const p of providersRaw) {
  const [provider] = await db.insert(schema.providers).values({
    name: p.name,
    email: p.email,
    phone: p.phone,
    specialties: p.specialties,
    isActive: p.isActive,
    serviceRadiusMiles: p.serviceRadiusMiles,
    timezone: p.timezone,
  }).returning();

  // Seed schedule
  for (const s of p.schedule) {
    await db.insert(schema.providerAvailability).values({
      providerId: provider.id,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
    });
  }

  // Link all services if allServices is true
  if (p.allServices) {
    const allServices = await db.select({ id: schema.services.id }).from(schema.services);
    for (const svc of allServices) {
      await db.insert(schema.providerServices).values({
        providerId: provider.id,
        serviceId: svc.id,
      });
    }
  }

  console.log(`  - ${provider.name}: ${p.schedule.length} schedule slots, all services linked`);
}
```

Also add cleanup at the top of `seed()` (before existing clears), in dependency order:

```typescript
await db.delete(schema.providerServices);
await db.delete(schema.providerAvailability);
await db.delete(schema.providerScheduleOverrides);
await db.delete(schema.providers);
```

**Step 3: Run the seed**

Run: `deno task --cwd apps/api db:seed`
Expected: "Inserting 1 providers...", provider listed with schedule slots.

**Step 4: Verify data**

Run via Supabase MCP `execute_sql`:
```sql
SELECT p.name, count(pa.id) as schedule_slots, count(ps.service_id) as services
FROM providers p
LEFT JOIN provider_availability pa ON pa.provider_id = p.id
LEFT JOIN provider_services ps ON ps.provider_id = p.id
GROUP BY p.name;
```
Expected: Spencer with 6 schedule slots and all services linked.

**Step 5: Commit**

```bash
git add apps/api/src/db/seed-data/providers.json apps/api/src/db/seed.ts
git commit -m "feat(db): add provider seed data with schedule and service links"
```

---

### Task 5: Agent Tool — `get_availability`

**Files:**
- Create: `apps/api/src/tools/scheduling.ts`

**Step 1: Create the scheduling tools file**

Create `apps/api/src/tools/scheduling.ts` with the `get_availability` tool:

```typescript
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import { and, eq, gte, inArray, lt, not, sql } from "drizzle-orm";
import { toolResult } from "@hmls/shared/tool-result";

/**
 * Discretize continuous free time ranges into bookable slots.
 * Only returns slots where the full service duration fits.
 */
function discretizeSlots(
  freeRanges: Array<{ start: Date; end: Date }>,
  serviceDurationMinutes: number,
  slotIncrementMinutes = 30,
): string[] {
  const slots: string[] = [];
  for (const range of freeRanges) {
    let cursor = new Date(range.start);
    const serviceEnd = new Date(cursor.getTime() + serviceDurationMinutes * 60_000);
    while (serviceEnd.getTime() <= range.end.getTime()) {
      slots.push(cursor.toISOString());
      cursor = new Date(cursor.getTime() + slotIncrementMinutes * 60_000);
      serviceEnd.setTime(cursor.getTime() + serviceDurationMinutes * 60_000);
    }
  }
  return slots;
}

export const getAvailabilityTool = {
  name: "get_availability",
  description:
    "Check available appointment time slots for a given service and date range. Returns available slots grouped by mechanic. Use this to help the customer find a time for their appointment.",
  schema: z.object({
    serviceType: z
      .string()
      .describe("The service category name (e.g., 'Oil Change', 'Brake Service')"),
    date: z
      .string()
      .describe("Start date to check in YYYY-MM-DD format"),
    endDate: z
      .string()
      .optional()
      .describe("End date in YYYY-MM-DD format (defaults to 7 days from date)"),
    preferredMechanicId: z
      .number()
      .optional()
      .describe("Preferred mechanic provider ID if the customer has one"),
  }),
  execute: async (
    params: {
      serviceType: string;
      date: string;
      endDate?: string;
      preferredMechanicId?: number;
    },
    _ctx: unknown,
  ) => {
    const startDate = params.date;
    const endDate = params.endDate ||
      new Date(new Date(params.date).getTime() + 7 * 24 * 60 * 60_000)
        .toISOString()
        .split("T")[0];

    // Look up service to get labor hours (duration)
    const [service] = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.name, params.serviceType))
      .limit(1);

    const serviceDurationMinutes = service
      ? Math.ceil(Number(service.laborHours) * 60)
      : 60;

    // Get active providers who can perform this service
    let providerIds: number[] = [];
    if (service) {
      const linked = await db
        .select({ providerId: schema.providerServices.providerId })
        .from(schema.providerServices)
        .where(eq(schema.providerServices.serviceId, service.id));
      providerIds = linked.map((l) => l.providerId);
    }

    if (providerIds.length === 0) {
      // Fall back to all active providers
      const allProviders = await db
        .select({ id: schema.providers.id })
        .from(schema.providers)
        .where(eq(schema.providers.isActive, true));
      providerIds = allProviders.map((p) => p.id);
    }

    // Get provider details
    const providers = await db
      .select()
      .from(schema.providers)
      .where(
        and(
          inArray(schema.providers.id, providerIds),
          eq(schema.providers.isActive, true),
        ),
      );

    // For each provider, for each date in range, compute available slots
    const result: Array<{
      providerId: number;
      providerName: string;
      isPreferred: boolean;
      availableTimes: string[];
    }> = [];

    const bufferBefore = 30;
    const bufferAfter = 15;
    const totalBlockedMinutes = serviceDurationMinutes + bufferBefore + bufferAfter;

    for (const provider of providers) {
      const availableTimes: string[] = [];

      // Get this provider's weekly schedule
      const schedule = await db
        .select()
        .from(schema.providerAvailability)
        .where(eq(schema.providerAvailability.providerId, provider.id));

      // Get overrides for date range
      const overrides = await db
        .select()
        .from(schema.providerScheduleOverrides)
        .where(
          and(
            eq(schema.providerScheduleOverrides.providerId, provider.id),
            gte(schema.providerScheduleOverrides.overrideDate, startDate),
            lt(schema.providerScheduleOverrides.overrideDate, endDate),
          ),
        );

      // Iterate each date in range
      const current = new Date(startDate);
      const end = new Date(endDate);
      while (current <= end) {
        const dateStr = current.toISOString().split("T")[0];
        const dayOfWeek = current.getDay();

        // Check for override on this date
        const override = overrides.find((o) => o.overrideDate === dateStr);
        let workingStart: string | null = null;
        let workingEnd: string | null = null;

        if (override) {
          if (!override.isAvailable) {
            current.setDate(current.getDate() + 1);
            continue; // Day off
          }
          workingStart = override.startTime ?? null;
          workingEnd = override.endTime ?? null;
        }

        if (!workingStart || !workingEnd) {
          // Use regular schedule
          const daySchedule = schedule.find((s) => s.dayOfWeek === dayOfWeek);
          if (!daySchedule) {
            current.setDate(current.getDate() + 1);
            continue; // No schedule for this day
          }
          workingStart = daySchedule.startTime;
          workingEnd = daySchedule.endTime;
        }

        // Build working range as timestamps
        const tz = provider.timezone || "America/Los_Angeles";
        const dayStart = new Date(`${dateStr}T${workingStart}:00`);
        const dayEnd = new Date(`${dateStr}T${workingEnd}:00`);

        // Get existing bookings for this provider on this day
        const existingBookings = await db.execute(
          sql`SELECT blocked_range FROM bookings
              WHERE provider_id = ${provider.id}
              AND status NOT IN ('cancelled', 'no_show')
              AND blocked_range IS NOT NULL
              AND blocked_range && tstzrange(${dayStart.toISOString()}::timestamptz, ${dayEnd.toISOString()}::timestamptz, '[)')
              ORDER BY scheduled_at`,
        );

        // Compute free ranges by subtracting bookings from working hours
        const booked: Array<{ start: Date; end: Date }> = [];
        for (const row of existingBookings.rows ?? existingBookings) {
          const rangeStr = (row as Record<string, string>).blocked_range;
          if (rangeStr) {
            // Parse tstzrange string like ["2026-02-24 09:00:00-08","2026-02-24 10:30:00-08")
            const match = rangeStr.match(
              /["[](.+?)[",](.+?)[")\]]/,
            );
            if (match) {
              booked.push({
                start: new Date(match[1].trim()),
                end: new Date(match[2].trim()),
              });
            }
          }
        }

        // Subtract booked ranges from working hours to get free ranges
        const freeRanges: Array<{ start: Date; end: Date }> = [];
        let freeStart = dayStart;
        for (const b of booked.sort((a, c) => a.start.getTime() - c.start.getTime())) {
          if (b.start > freeStart) {
            freeRanges.push({ start: new Date(freeStart), end: new Date(b.start) });
          }
          if (b.end > freeStart) {
            freeStart = new Date(b.end);
          }
        }
        if (freeStart < dayEnd) {
          freeRanges.push({ start: new Date(freeStart), end: new Date(dayEnd) });
        }

        // Discretize into bookable slots
        const daySlots = discretizeSlots(freeRanges, totalBlockedMinutes);
        availableTimes.push(...daySlots);

        current.setDate(current.getDate() + 1);
      }

      if (availableTimes.length > 0) {
        result.push({
          providerId: provider.id,
          providerName: provider.name,
          isPreferred: provider.id === params.preferredMechanicId,
          availableTimes,
        });
      }
    }

    // Sort: preferred mechanic first
    result.sort((a, b) => (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0));

    return toolResult({
      slots: result,
      serviceDurationMinutes,
      dateRange: { start: startDate, end: endDate },
    });
  },
};
```

**Step 2: Verify types compile**

Run: `deno task check:api`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/tools/scheduling.ts
git commit -m "feat(api): add get_availability tool with multi-provider slot computation"
```

---

### Task 6: Agent Tool — `create_booking`

**Files:**
- Modify: `apps/api/src/tools/scheduling.ts` (add create_booking)

**Step 1: Add `create_booking` tool to scheduling.ts**

Append to `apps/api/src/tools/scheduling.ts`:

```typescript
export const createBookingTool = {
  name: "create_booking",
  description:
    "Create a work order / booking request for a customer. This collects all the details the mechanic needs to show up prepared. The booking starts as 'requested' and the mechanic will confirm it. Call get_availability first to get a valid time slot and provider ID.",
  schema: z.object({
    // Vehicle
    vehicleYear: z.number().describe("Vehicle year (e.g., 2019)"),
    vehicleMake: z.string().describe("Vehicle make (e.g., BMW)"),
    vehicleModel: z.string().describe("Vehicle model (e.g., 330i)"),
    vehicleMileage: z.number().optional().describe("Approximate mileage"),
    // Service
    serviceType: z.string().describe("Service category (e.g., 'Brake Service')"),
    serviceItems: z
      .array(
        z.object({
          name: z.string().describe("Line item name (e.g., 'Front brake pads + rotors')"),
          partsNeeded: z.boolean().describe("Whether parts are needed for this item"),
          partsNote: z
            .string()
            .optional()
            .describe("Parts preference (e.g., 'OEM preferred', 'Customer supplying pads')"),
        }),
      )
      .describe("Specific service line items for the work order"),
    symptomDescription: z
      .string()
      .optional()
      .describe("Customer's description of the problem/symptoms"),
    estimateId: z.number().optional().describe("ID of a previously generated estimate"),
    // Scheduling
    providerId: z.number().describe("Mechanic provider ID from get_availability"),
    appointmentStart: z
      .string()
      .describe("Appointment start time in ISO 8601 format, from get_availability"),
    durationMinutes: z.number().describe("Service duration in minutes"),
    // Location
    address: z.string().describe("Service address where the mechanic should come"),
    locationLat: z.number().optional().describe("Latitude"),
    locationLng: z.number().optional().describe("Longitude"),
    accessInstructions: z
      .string()
      .optional()
      .describe("How to access the location (gate codes, parking, etc.)"),
    // Customer (for guests)
    customerName: z.string().optional().describe("Customer name (for guest bookings)"),
    customerEmail: z.string().optional().describe("Customer email (for guest bookings)"),
    customerPhone: z.string().optional().describe("Customer phone (for guest bookings)"),
    // Media
    photoUrls: z
      .array(z.string())
      .optional()
      .describe("URLs of photos/videos of the issue"),
    // Notes
    customerNotes: z
      .string()
      .optional()
      .describe("Customer's additional notes (e.g., 'keys under mat')"),
    internalNotes: z
      .string()
      .optional()
      .describe("Your internal assessment notes (not shown to customer)"),
  }),
  execute: async (
    params: {
      vehicleYear: number;
      vehicleMake: string;
      vehicleModel: string;
      vehicleMileage?: number;
      serviceType: string;
      serviceItems: Array<{
        name: string;
        partsNeeded: boolean;
        partsNote?: string;
      }>;
      symptomDescription?: string;
      estimateId?: number;
      providerId: number;
      appointmentStart: string;
      durationMinutes: number;
      address: string;
      locationLat?: number;
      locationLng?: number;
      accessInstructions?: string;
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
      photoUrls?: string[];
      customerNotes?: string;
      internalNotes?: string;
    },
    _ctx: unknown,
  ) => {
    // Get provider name for confirmation message
    const [provider] = await db
      .select()
      .from(schema.providers)
      .where(eq(schema.providers.id, params.providerId))
      .limit(1);

    if (!provider) {
      return toolResult({
        success: false,
        error: "Invalid mechanic ID. Please choose a valid time slot from get_availability.",
      });
    }

    try {
      const scheduledAt = new Date(params.appointmentStart);

      const [booking] = await db
        .insert(schema.bookings)
        .values({
          providerId: params.providerId,
          serviceType: params.serviceType,
          serviceItems: params.serviceItems,
          symptomDescription: params.symptomDescription || null,
          vehicleYear: params.vehicleYear,
          vehicleMake: params.vehicleMake,
          vehicleModel: params.vehicleModel,
          vehicleMileage: params.vehicleMileage || null,
          estimateId: params.estimateId || null,
          scheduledAt,
          durationMinutes: params.durationMinutes,
          location: params.address,
          locationLat: params.locationLat?.toString() || null,
          locationLng: params.locationLng?.toString() || null,
          accessInstructions: params.accessInstructions || null,
          customerName: params.customerName || null,
          customerEmail: params.customerEmail || null,
          customerPhone: params.customerPhone || null,
          photoUrls: params.photoUrls || null,
          customerNotes: params.customerNotes || null,
          internalNotes: params.internalNotes || null,
          status: "requested",
        })
        .returning();

      const appointmentEnd = new Date(
        scheduledAt.getTime() + params.durationMinutes * 60_000,
      );

      return toolResult({
        success: true,
        bookingId: booking.id,
        status: "requested",
        providerName: provider.name,
        appointmentStart: scheduledAt.toISOString(),
        appointmentEnd: appointmentEnd.toISOString(),
        vehicle: `${params.vehicleYear} ${params.vehicleMake} ${params.vehicleModel}`,
        serviceType: params.serviceType,
        location: params.address,
        message:
          `Booking requested! ${provider.name} will confirm your appointment shortly.`,
      });
    } catch (error: unknown) {
      // Check for exclusion constraint violation (overlap)
      const pgError = error as { code?: string };
      if (pgError.code === "23P01") {
        return toolResult({
          success: false,
          error:
            "This time slot is no longer available. Please call get_availability again to find an open slot.",
        });
      }
      throw error;
    }
  },
};

// Export all scheduling tools
export const schedulingTools = [getAvailabilityTool, createBookingTool];
```

**Step 2: Verify types compile**

Run: `deno task check:api`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/tools/scheduling.ts
git commit -m "feat(api): add create_booking work order tool with overlap protection"
```

---

### Task 7: Wire Agent — Completed (Cal.com removed 2026-03-01)

Cal.com integration (`calcom.ts`, env vars, AgentConfig fields) fully removed. Scheduling tools wired directly.

---

### Task 8: Update System Prompt — Work Order Flow

**Files:**
- Modify: `apps/api/src/system-prompt.ts`

**Step 1: Update the booking workflow section**

Replace the "### Booking Appointments" section in the system prompt with:

```typescript
### Booking Appointments (Work Order Flow)

When a customer wants to book an appointment, gather ALL of these details before calling create_booking:

1. **Service & symptoms** — What service do they need? What symptoms are they experiencing? Use ask_user_question for service selection.
2. **Vehicle info** — Year, make, model (ask as open text). Optional: mileage.
3. **Service items & parts** — Specific line items (e.g., "Front brake pads + rotors"). Ask about parts preference: OEM, aftermarket, or customer-supplied.
4. **Estimate** — If the customer wants a price first, use create_estimate. Link the estimate_id to the booking.
5. **Photos** — Ask if they can share photos of the issue (optional but helpful for complex jobs).
6. **Availability** — Call get_availability with the service type and preferred date. Present the results to the customer.
7. **Location** — Full address where the mechanic should come. Ask about access instructions (gate codes, parking, which side of the building).
8. **Review** — Summarize the complete work order and use ask_user_question to confirm before submitting.
9. **Book** — Call create_booking with ALL gathered details.

The booking is created as "requested" — tell the customer their mechanic will confirm shortly.

**For returning customers:** If you know the customer from a previous conversation, mention their preferred mechanic by name if one is available.

**NEVER skip the review step.** Always show a summary and get explicit confirmation before calling create_booking.
```

Cal.com references in system prompt removed (2026-03-01).

**Step 2: Verify types compile**

Run: `deno task check:api`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/system-prompt.ts
git commit -m "feat(api): update system prompt with work order booking flow"
```

---

### Task 9: Chat UI — SlotPicker Component

**Files:**
- Create: `apps/web/components/SlotPicker.tsx`

**Step 1: Create the SlotPicker component**

Create `apps/web/components/SlotPicker.tsx`:

```tsx
"use client";

import { motion } from "framer-motion";
import { Calendar, Clock, User } from "lucide-react";

interface ProviderSlots {
  providerId: number;
  providerName: string;
  isPreferred: boolean;
  availableTimes: string[];
}

interface SlotPickerData {
  slots: ProviderSlots[];
  serviceDurationMinutes: number;
  dateRange: { start: string; end: string };
}

interface SlotPickerProps {
  data: SlotPickerData;
  onSelect: (providerId: number, providerName: string, time: string) => void;
  disabled?: boolean;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Group times by date */
function groupByDate(times: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const t of times) {
    const date = t.split("T")[0];
    if (!groups[date]) groups[date] = [];
    groups[date].push(t);
  }
  return groups;
}

export function SlotPicker({ data, onSelect, disabled }: SlotPickerProps) {
  if (data.slots.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-start"
      >
        <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-surface-alt border border-border px-5 py-4">
          <p className="text-sm text-text-secondary">
            No available slots found for this date range. Try a different date.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="flex justify-start"
    >
      <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-surface-alt border border-border px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-red-primary" />
          <p className="text-xs font-medium text-red-primary uppercase tracking-wide">
            Available Times
          </p>
        </div>

        <div className="space-y-4">
          {data.slots.map((provider) => {
            const dateGroups = groupByDate(provider.availableTimes);
            return (
              <div key={provider.providerId}>
                <div className="flex items-center gap-2 mb-2">
                  <User className="w-3.5 h-3.5 text-text-secondary" />
                  <span className="text-sm font-medium text-text">
                    {provider.providerName}
                  </span>
                  {provider.isPreferred && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-light text-red-primary font-medium">
                      Your mechanic
                    </span>
                  )}
                </div>

                {Object.entries(dateGroups).map(([date, times]) => (
                  <div key={date} className="mb-2">
                    <p className="text-xs text-text-secondary mb-1.5">
                      {formatDate(times[0])}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {times.map((time) => (
                        <motion.button
                          key={time}
                          type="button"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          disabled={disabled}
                          onClick={() =>
                            onSelect(
                              provider.providerId,
                              provider.providerName,
                              time,
                            )
                          }
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text hover:border-red-primary/50 hover:bg-red-light/30 transition-colors disabled:opacity-50"
                        >
                          <Clock className="w-3 h-3 text-text-secondary" />
                          {formatTime(time)}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-text-secondary mt-3">
          Est. {data.serviceDurationMinutes} min service
        </p>
      </div>
    </motion.div>
  );
}
```

**Step 2: Verify types compile**

Run: `cd apps/web && bun run typecheck`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/web/components/SlotPicker.tsx
git commit -m "feat(web): add SlotPicker chat component for availability display"
```

---

### Task 10: Chat UI — BookingConfirmation Component

**Files:**
- Create: `apps/web/components/BookingConfirmation.tsx`

**Step 1: Create the BookingConfirmation component**

Create `apps/web/components/BookingConfirmation.tsx`:

```tsx
"use client";

import { motion } from "framer-motion";
import { Calendar, Car, CheckCircle, Clock, MapPin, User, Wrench } from "lucide-react";

interface BookingConfirmationData {
  success: boolean;
  bookingId: number;
  status: string;
  providerName: string;
  appointmentStart: string;
  appointmentEnd: string;
  vehicle: string;
  serviceType: string;
  location: string;
  message: string;
  error?: string;
}

interface BookingConfirmationProps {
  data: BookingConfirmationData;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function BookingConfirmation({ data }: BookingConfirmationProps) {
  if (!data.success) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-start"
      >
        <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-red-50 border border-red-200 px-5 py-4">
          <p className="text-sm text-red-700">{data.error || "Booking failed"}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="flex justify-start"
    >
      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-surface-alt border border-border overflow-hidden">
        {/* Header */}
        <div className="bg-red-primary/10 px-5 py-3 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-red-primary" />
          <span className="text-sm font-medium text-red-primary">
            Booking Requested
          </span>
          <span className="ml-auto text-xs text-text-secondary">
            #{data.bookingId}
          </span>
        </div>

        {/* Details */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <Wrench className="w-4 h-4 text-text-secondary mt-0.5" />
            <div>
              <p className="text-sm font-medium text-text">{data.serviceType}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Car className="w-4 h-4 text-text-secondary mt-0.5" />
            <p className="text-sm text-text">{data.vehicle}</p>
          </div>

          <div className="flex items-start gap-3">
            <Calendar className="w-4 h-4 text-text-secondary mt-0.5" />
            <div>
              <p className="text-sm text-text">
                {formatDateTime(data.appointmentStart)}
              </p>
              <p className="text-xs text-text-secondary">
                Until {formatTime(data.appointmentEnd)}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <User className="w-4 h-4 text-text-secondary mt-0.5" />
            <p className="text-sm text-text">{data.providerName}</p>
          </div>

          <div className="flex items-start gap-3">
            <MapPin className="w-4 h-4 text-text-secondary mt-0.5" />
            <p className="text-sm text-text">{data.location}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-surface border-t border-border">
          <p className="text-xs text-text-secondary">{data.message}</p>
        </div>
      </div>
    </motion.div>
  );
}
```

**Step 2: Verify types compile**

Run: `cd apps/web && bun run typecheck`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/web/components/BookingConfirmation.tsx
git commit -m "feat(web): add BookingConfirmation chat component"
```

---

### Task 11: Wire Chat UI — Intercept Tool Results

**Files:**
- Modify: `apps/web/hooks/useAgentChat.ts` (add slot picker + booking confirmation state)
- Modify: `apps/web/app/chat/page.tsx` (render new components)

**Step 1: Update useAgentChat.ts**

In `apps/web/hooks/useAgentChat.ts`:

1. Add new state for slot picker and booking confirmations:

```typescript
const [pendingSlotPicker, setPendingSlotPicker] = useState<Record<string, unknown> | null>(null);
const [bookingConfirmations, setBookingConfirmations] = useState<Array<{ id: string; data: Record<string, unknown> }>>([]);
```

2. In the `onToolCallEndEvent` handler, add interception for the new tools:

```typescript
onToolCallEndEvent: ({ toolCallName, toolCallArgs, toolCallResult }) => {
  if (toolCallName === "ask_user_question") {
    setPendingQuestion(toolCallArgs as QuestionData);
  }
  if (toolCallName === "get_availability" && toolCallResult) {
    try {
      const result = typeof toolCallResult === "string"
        ? JSON.parse(toolCallResult)
        : toolCallResult;
      setPendingSlotPicker(result);
    } catch { /* ignore parse errors */ }
  }
  if (toolCallName === "create_booking" && toolCallResult) {
    try {
      const result = typeof toolCallResult === "string"
        ? JSON.parse(toolCallResult)
        : toolCallResult;
      setBookingConfirmations((prev) => [
        ...prev,
        { id: crypto.randomUUID(), data: result },
      ]);
    } catch { /* ignore parse errors */ }
  }
  setCurrentTool(null);
},
```

3. Add a `selectSlot` callback:

```typescript
const selectSlot = useCallback(
  (providerId: number, providerName: string, time: string) => {
    setPendingSlotPicker(null);
    const formatted = new Date(time).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    sendMessage(
      `I'd like the ${formatted} slot with ${providerName}`,
    );
  },
  [sendMessage],
);
```

4. Add to `clearMessages`:

```typescript
const clearMessages = useCallback(() => {
  setMessages([]);
  setPendingQuestion(null);
  setPendingSlotPicker(null);
  setBookingConfirmations([]);
  agentRef.current = null;
}, []);
```

5. Return the new state and callbacks:

```typescript
return {
  messages,
  isLoading,
  error,
  currentTool,
  pendingQuestion,
  pendingSlotPicker,
  bookingConfirmations,
  sendMessage,
  answerQuestion,
  selectSlot,
  clearMessages,
  clearError,
};
```

**Step 2: Update chat/page.tsx**

In `apps/web/app/chat/page.tsx`:

1. Import the new components:

```typescript
import { SlotPicker } from "@/components/SlotPicker";
import { BookingConfirmation } from "@/components/BookingConfirmation";
```

2. Destructure the new state from the hook:

```typescript
const {
  messages,
  isLoading,
  error,
  currentTool,
  pendingQuestion,
  pendingSlotPicker,
  bookingConfirmations,
  sendMessage,
  answerQuestion,
  selectSlot,
  clearMessages,
  clearError,
} = useAgentChat({ accessToken: session?.access_token });
```

3. After the `{/* Question card */}` section, add slot picker and booking confirmations:

```tsx
{/* Slot picker */}
<AnimatePresence>
  {pendingSlotPicker && (
    <SlotPicker
      data={pendingSlotPicker as any}
      onSelect={selectSlot}
      disabled={isLoading}
    />
  )}
</AnimatePresence>

{/* Booking confirmations */}
{bookingConfirmations.map((bc) => (
  <BookingConfirmation key={bc.id} data={bc.data as any} />
))}
```

**Step 3: Verify types compile and build**

Run: `cd apps/web && bun run typecheck`
Run: `cd apps/web && bun run build`
Expected: No errors.

**Step 4: Commit**

```bash
git add apps/web/hooks/useAgentChat.ts apps/web/app/chat/page.tsx
git commit -m "feat(web): wire SlotPicker and BookingConfirmation into chat UI"
```

---

### Task 12: Hero Quick-Start Widget

**Files:**
- Modify: `apps/web/components/sections/HeroNew.tsx` (replace CTA buttons with booking widget)

**Step 1: Replace the CTA buttons with the booking widget**

Replace the `<div className="flex flex-col sm:flex-row gap-4 justify-center">` section in `HeroNew.tsx` with:

```tsx
{/* Booking Widget */}
<BookingWidget />
```

Create the `BookingWidget` as a client component within the file or as a separate file. Since HeroNew is a server component, create `apps/web/components/BookingWidget.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ArrowRight } from "lucide-react";

const services = [
  { value: "oil_change", label: "Oil Change" },
  { value: "brake_service", label: "Brake Service" },
  { value: "battery_electrical", label: "Battery & Electrical" },
  { value: "engine_diagnostics", label: "Engine Diagnostics" },
  { value: "ac_service", label: "A/C Service" },
  { value: "suspension", label: "Suspension" },
];

export function BookingWidget() {
  const router = useRouter();
  const [service, setService] = useState("");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");

  const today = new Date().toISOString().split("T")[0];
  const maxDate = new Date(Date.now() + 14 * 24 * 60 * 60_000)
    .toISOString()
    .split("T")[0];

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (service) params.set("service", service);
    if (date) params.set("date", date);
    if (location) params.set("location", location);
    router.push(`/chat${params.toString() ? `?${params}` : ""}`);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col sm:flex-row gap-3 justify-center items-stretch max-w-2xl mx-auto"
    >
      <select
        value={service}
        onChange={(e) => setService(e.target.value)}
        className="flex-1 px-4 py-3 rounded-lg border border-border bg-surface text-text text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-primary"
      >
        <option value="">Select service...</option>
        {services.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        min={today}
        max={maxDate}
        className="flex-1 px-4 py-3 rounded-lg border border-border bg-surface text-text text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-primary"
      />

      <input
        type="text"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="ZIP or address"
        className="flex-1 px-4 py-3 rounded-lg border border-border bg-surface text-text text-sm placeholder-text-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-primary"
      />

      <button
        type="submit"
        className="px-6 py-3 bg-red-primary text-white rounded-lg text-sm font-medium hover:bg-red-dark transition-colors flex items-center justify-center gap-2"
      >
        Book Now
        <ArrowRight className="w-4 h-4" />
      </button>
    </form>
  );
}
```

Then update `HeroNew.tsx` to import and use it:

```tsx
import { BookingWidget } from "@/components/BookingWidget";
```

Replace the two Link buttons section with `<BookingWidget />`.

**Step 2: Verify types compile and build**

Run: `cd apps/web && bun run typecheck`
Run: `cd apps/web && bun run build`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/web/components/BookingWidget.tsx apps/web/components/sections/HeroNew.tsx
git commit -m "feat(web): add hero booking widget with service/date/location quick-start"
```

---

### Task 13: Chat Page — Read Query Params for Pre-Seeded Context

**Files:**
- Modify: `apps/web/app/chat/page.tsx` (read URL params, send auto-message)

**Step 1: Read query params and auto-send initial message**

In `apps/web/app/chat/page.tsx`:

1. Import `useSearchParams` from `next/navigation`.
2. After the hook destructuring, add:

```typescript
const searchParams = useSearchParams();

// Auto-send initial message from hero widget params
const hasSentInitial = useRef(false);
useEffect(() => {
  if (hasSentInitial.current || messages.length > 0) return;
  const service = searchParams.get("service");
  const date = searchParams.get("date");
  const location = searchParams.get("location");

  if (service || date || location) {
    hasSentInitial.current = true;
    const parts: string[] = [];
    if (service) parts.push(`I need a ${service.replace(/_/g, " ")}`);
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
```

**Step 2: Remove the login wall for guest access**

The current chat page shows a login prompt if `!user`. For guest booking support, change this to show the chat interface regardless of auth status (the agent handles guest info collection). Remove or modify the `if (!user)` block to allow anonymous access. The `useAgentChat` hook already passes `accessToken` which is optional.

**Step 3: Verify build**

Run: `cd apps/web && bun run build`
Expected: No errors.

**Step 4: Commit**

```bash
git add apps/web/app/chat/page.tsx
git commit -m "feat(web): read hero query params and enable guest chat access"
```

---

### Task 14: Delete Cal.com Tool File — Completed (2026-03-01)

`calcom.ts` deleted and all references removed.

---

### Task 15: Full CI Validation

**Files:** None (verification only)

**Step 1: Run the full CI suite**

```bash
cd apps/web && bun run lint
cd apps/web && bun run typecheck
cd apps/web && bun run build
deno task check:api
deno task check:diagnostic
```

Expected: All pass.

**Step 2: Run the migration + seed on the live database**

```bash
deno task --cwd apps/api db:migrate
deno task --cwd apps/api db:seed
```

Expected: Both succeed.

**Step 3: Verify Supabase security advisors**

Run `get_advisors` for security — check that new tables have appropriate RLS if needed.

**Step 4: Manual smoke test**

1. Start the dev servers: `cd apps/web && bun run dev` and `deno task dev:api`
2. Open `http://localhost:3000`
3. Verify the hero widget appears with service/date/location inputs
4. Fill in the widget and click "Book Now" — should navigate to `/chat?service=...&date=...&location=...`
5. Verify the chat auto-sends the initial message
6. Interact with the agent through a full booking flow
7. Verify SlotPicker renders when availability is checked
8. Verify BookingConfirmation renders when a booking is created

**Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address CI and smoke test issues"
```
