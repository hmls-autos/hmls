# Custom Appointment System Design

**Date:** 2026-02-22 **Status:** Implemented — Cal.com fully removed 2026-03-01 **Replaces:** Former
Cal.com integration (deleted)

## Overview

Custom Supabase-backed appointment system. The system is fully agentic — the AI chat agent drives
the booking flow using rich UI components. A hero quick-start widget on the landing page pre-seeds
the conversation with context.

### Key Requirements

- Multi-mechanic support with auto-assignment and returning customer preference
- Database-enforced overlap prevention via PostgreSQL `tstzrange` + exclusion constraints
- Travel/buffer time between appointments
- Full work order capture (vehicle, symptoms, parts, photos, access instructions)
- Guest booking with optional login (auto-fill if authenticated)
- Request-and-approve flow (`requested` status, mechanic confirms)
- Rich chat UI components (slot picker, estimate card, booking confirmation)

## Database Schema

### Extension

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

Required for mixing equality (`=`) and range overlap (`&&`) in GiST exclusion constraints.

### `providers` — Mechanic Profiles

```sql
CREATE TABLE providers (
    id                    SERIAL PRIMARY KEY,
    name                  VARCHAR(255) NOT NULL,
    email                 VARCHAR(255),
    phone                 VARCHAR(20),
    specialties           JSONB,             -- ["brakes", "engine", "electrical"]
    is_active             BOOLEAN NOT NULL DEFAULT true,
    service_radius_miles  INTEGER DEFAULT 30,
    home_base_lat         NUMERIC(10, 7),
    home_base_lng         NUMERIC(10, 7),
    timezone              VARCHAR(50) NOT NULL DEFAULT 'America/Los_Angeles',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `provider_availability` — Recurring Weekly Schedule

```sql
CREATE TABLE provider_availability (
    id              SERIAL PRIMARY KEY,
    provider_id     INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    CHECK (start_time < end_time),
    UNIQUE (provider_id, day_of_week, start_time)
);
```

### `provider_schedule_overrides` — Date-Specific Overrides

```sql
CREATE TABLE provider_schedule_overrides (
    id              SERIAL PRIMARY KEY,
    provider_id     INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    override_date   DATE NOT NULL,
    is_available    BOOLEAN NOT NULL DEFAULT false,
    start_time      TIME,          -- NULL if is_available = false
    end_time        TIME,          -- NULL if is_available = false
    reason          TEXT,
    UNIQUE (provider_id, override_date)
);
```

### `provider_services` — Service Capabilities

```sql
CREATE TABLE provider_services (
    provider_id     INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    service_id      INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    PRIMARY KEY (provider_id, service_id)
);
```

### `bookings` — Work Orders with Overlap Prevention

```sql
CREATE TABLE bookings (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider_id             INTEGER NOT NULL REFERENCES providers(id),
    customer_id             INTEGER REFERENCES customers(id),

    -- Service details
    service_type            VARCHAR(100) NOT NULL,
    service_items           JSONB NOT NULL,    -- [{name, partsNeeded, partsNote}]
    symptom_description     TEXT,

    -- Vehicle
    vehicle_year            INTEGER NOT NULL,
    vehicle_make            VARCHAR(50) NOT NULL,
    vehicle_model           VARCHAR(50) NOT NULL,
    vehicle_mileage         INTEGER,

    -- Estimate reference
    estimate_id             INTEGER REFERENCES estimates(id),

    -- Scheduling
    appointment_start       TIMESTAMPTZ NOT NULL,
    appointment_end         TIMESTAMPTZ NOT NULL,
    buffer_before_minutes   INTEGER NOT NULL DEFAULT 30,
    buffer_after_minutes    INTEGER NOT NULL DEFAULT 15,
    blocked_range           TSTZRANGE NOT NULL,  -- computed by trigger

    -- Location
    location                TEXT NOT NULL,
    location_lat            NUMERIC(10, 7),
    location_lng            NUMERIC(10, 7),
    access_instructions     TEXT,

    -- Guest customer info (when not logged in)
    customer_name           VARCHAR(255),
    customer_email          VARCHAR(255),
    customer_phone          VARCHAR(20),

    -- Media
    photo_urls              JSONB,             -- ["https://..."]

    -- Notes
    customer_notes          TEXT,
    internal_notes          TEXT,              -- agent assessment, not shown to customer

    -- Preference
    preferred_mechanic_id   INTEGER REFERENCES providers(id),

    -- Status
    status                  VARCHAR(20) NOT NULL DEFAULT 'requested'
                            CHECK (status IN (
                                'requested', 'confirmed', 'in_progress',
                                'completed', 'cancelled', 'no_show'
                            )),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (appointment_start < appointment_end),

    -- DATABASE-LEVEL OVERLAP PREVENTION
    EXCLUDE USING gist (
        provider_id WITH =,
        blocked_range WITH &&
    ) WHERE (status NOT IN ('cancelled', 'no_show'))
);
```

### Trigger — Auto-Compute `blocked_range`

```sql
CREATE OR REPLACE FUNCTION compute_blocked_range()
RETURNS TRIGGER AS $$
BEGIN
    NEW.blocked_range := tstzrange(
        NEW.appointment_start - make_interval(mins => NEW.buffer_before_minutes),
        NEW.appointment_end   + make_interval(mins => NEW.buffer_after_minutes),
        '[)'
    );
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compute_blocked_range
    BEFORE INSERT OR UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION compute_blocked_range();
```

### Indexes

```sql
-- Fast availability lookups
CREATE INDEX idx_bookings_provider_time
    ON bookings USING gist (provider_id, blocked_range)
    WHERE status NOT IN ('cancelled', 'no_show');

-- Customer booking history
CREATE INDEX idx_bookings_customer
    ON bookings (customer_id, appointment_start DESC);
```

### Design Decisions

| Decision                | Choice                                              | Rationale                                                     |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Time representation     | `tstzrange` closed-open `[)`                        | Eliminates off-by-one overlaps; enables exclusion constraints |
| Overlap prevention      | `EXCLUDE USING gist`                                | Database-enforced; handles race conditions automatically      |
| Slot generation         | Continuous ranges, discretized at query time        | Accommodates variable-duration services (30-min to 4-hr)      |
| Buffer/travel time      | Per-booking `buffer_before/after`, trigger-computed | Customer sees clean times; DB blocks expanded window          |
| Availability model      | Recurring schedule + date overrides                 | Matches industry standard (Calendly pattern)                  |
| Race condition handling | Optimistic insert, catch `23P01` error              | Simplest correct approach for low-medium concurrency          |

## Agent Tools

### `get_availability` — Check Available Slots

Custom availability query tool.

**Input:**

- `serviceType` (string, required) — service to look up duration
- `date` (string, required) — YYYY-MM-DD, or date range start
- `endDate` (string, optional) — defaults to 7 days from `date`
- `preferredMechanicId` (number, optional) — try this mechanic first

**Logic:**

1. Look up service duration from `services` table
2. Query `provider_availability` for each day in range, filtered by `provider_services`
3. Exclude providers blocked by `provider_schedule_overrides`
4. For each provider, compute: working hours - existing `bookings.blocked_range` overlaps
5. Discretize free ranges into 30-min snap points (only where service duration fits)
6. If `preferredMechanicId` set and available, list them first
7. Return slots grouped by provider

**Output:**

```json
{
  "slots": [
    {
      "providerId": 1,
      "providerName": "Mike",
      "isPreferred": true,
      "availableTimes": ["2026-02-24T09:00", "2026-02-24T11:00", "2026-02-24T14:00"]
    },
    {
      "providerId": 2,
      "providerName": "Sarah",
      "isPreferred": false,
      "availableTimes": ["2026-02-24T10:00", "2026-02-24T13:00"]
    }
  ],
  "serviceDurationMinutes": 150,
  "dateRange": { "start": "2026-02-24", "end": "2026-03-03" }
}
```

### `create_booking` — Create Work Order

Custom booking creation tool.

**Input:**

```typescript
{
  // Vehicle
  vehicleYear:        number,     // required
  vehicleMake:        string,     // required
  vehicleModel:       string,     // required
  vehicleMileage?:    number,

  // Service
  serviceType:        string,     // required
  serviceItems:       Array<{     // required — specific line items
    name:             string,     // "Front brake pads + rotors"
    partsNeeded:      boolean,
    partsNote?:       string,     // "OEM preferred" / "Customer supplying pads"
  }>,
  symptomDescription?: string,    // "Squealing when braking, worse at low speed"

  // Estimate reference
  estimateId?:        number,     // links to existing estimate

  // Scheduling
  providerId:         number,     // required — from get_availability
  appointmentStart:   string,     // ISO 8601
  durationMinutes:    number,     // required

  // Location
  address:            string,     // required
  locationLat?:       number,
  locationLng?:       number,
  accessInstructions?: string,    // "Gate code 4521, visitor spot #3"

  // Customer (for guests)
  customerName?:      string,
  customerEmail?:     string,
  customerPhone?:     string,

  // Media
  photoUrls?:         string[],   // photos/videos of the issue

  // Notes
  customerNotes?:     string,     // "Car is in driveway, keys under mat"
  internalNotes?:     string,     // agent's assessment (not shown to customer)
}
```

**Logic:**

1. Compute `appointment_end` from `appointmentStart + durationMinutes`
2. Insert into `bookings` with `status: 'requested'`
3. Trigger auto-computes `blocked_range` with buffer
4. If exclusion constraint violation (`23P01`): re-run `get_availability`, return alternatives
5. If guest: create/upsert customer record from name/email/phone
6. Return booking confirmation

**Output:**

```json
{
  "success": true,
  "bookingId": 42,
  "status": "requested",
  "providerName": "Mike",
  "appointmentStart": "2026-02-24T09:00:00-08:00",
  "appointmentEnd": "2026-02-24T11:30:00-08:00",
  "message": "Booking requested! Mike will confirm your appointment shortly."
}
```

### Removal (Completed 2026-03-01)

All Cal.com code, env vars, and FK references have been removed.

## Hero Quick-Start Widget

Replaces the current two-button CTA in `HeroNew.tsx`.

```
┌──────────────────────────────────────────────────────────────┐
│  [ Oil Change ▾ ]  [ Feb 24 ▾ ]  [ ZIP / Address ]  [ → ]  │
└──────────────────────────────────────────────────────────────┘
```

- **Service dropdown**: Populated from `services` table (static list initially, fetched later)
- **Date picker**: Today + 14 days, simple date input
- **Address/ZIP**: Text input with placeholder "Where should we come?"
- **Submit**: Navigates to `/chat?service=oil_change&date=2026-02-24&location=92612`
- **Mobile**: Stacks vertically, full-width inputs

The chat page reads query params and the agent opens with pre-seeded context: _"I see you're looking
for an oil change on Feb 24 near 92612. Let me check availability..."_

Guest-friendly — no login required to start the conversation.

## Rich Chat UI Components

Extend the existing AG-UI tool interception pattern (used for `ask_user_question` → `QuestionCard`).

### `SlotPicker`

Rendered when `get_availability` returns results.

- Visual time grid grouped by provider
- Preferred mechanic highlighted at top
- Customer taps a slot → sends as next message
- Mobile-friendly: horizontal scroll for dates, vertical list for times

### `EstimateCard`

Rendered when `create_estimate` returns results (already exists partially).

- Service line items with prices
- Vehicle info summary
- Price range (low-high)
- Action buttons: "Book Now" / "Adjust Services"

### `BookingConfirmation`

Rendered when `create_booking` succeeds.

- Status badge: "Awaiting Confirmation"
- Work order summary: vehicle, service, date/time, mechanic, location
- Compact card design

### Implementation Pattern

```typescript
// In useAgentChat hook — extend existing tool interception
if (toolName === "get_availability") {
  setPendingSlotPicker(toolResult); // renders <SlotPicker>
}
if (toolName === "create_booking") {
  addBookingConfirmation(toolResult); // renders <BookingConfirmation>
}
```

## System Prompt Changes

Update `apps/api/src/system-prompt.ts` booking workflow:

- Work order gathering flow:
  1. Ask about the issue / what service they need
  2. Collect vehicle info (year, make, model)
  3. Recommend service + gather parts preference
  4. Generate estimate if desired
  5. Ask for photos if relevant
  6. Check availability → present slots
  7. Collect location + access instructions
  8. Review full work order summary → confirm → create booking
- For returning customers: query previous bookings for preferred mechanic
- Status is always `requested` — tell customer "Your mechanic will confirm shortly"

## Guest Flow

1. Hero widget → `/chat?service=...&date=...&location=...` (no login wall)
2. Agent starts conversation with pre-seeded context
3. Full booking flow proceeds normally
4. When work order is ready, agent asks for name/email/phone
5. If logged in, info auto-fills from customer profile
6. Booking created with guest info stored on the booking record

## Out of Scope (Future)

- Admin dashboard for approving/declining bookings
- Push/SMS notifications when booking status changes
- Dynamic travel time estimation (Google Maps API)
- Route optimization for multi-booking days
- Customer booking history page
- Mechanic mobile app
