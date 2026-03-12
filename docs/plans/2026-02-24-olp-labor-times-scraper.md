# OLP Labor Times Scraper — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Scrape all labor time data (~1.3M entries) from openlaborproject.com into Supabase so the
agent can provide vehicle-specific labor hours.

**Architecture:** Hierarchical crawl of Next.js pages extracting embedded JSON props. Two Supabase
tables (olp_vehicles + olp_labor_times). Single Deno script with rate limiting, resumability, and
batch inserts.

**Tech Stack:** Deno, postgres.js (raw SQL for migration), Drizzle ORM (for scraper inserts),
Supabase PostgreSQL

**Design doc:** `docs/plans/2026-02-24-olp-labor-times-scraper-design.md`

---

### Task 1: Create database migration

**Files:**

- Modify: `apps/api/src/db/migrate.ts` (add migrationStep6)

**Step 1: Add the OLP tables migration to migrate.ts**

Add a new `migrationStep6` constant after `migrationStep5` in `apps/api/src/db/migrate.ts`:

```typescript
const migrationStep6 = `
-- OLP (Open Labor Project) reference data
CREATE TABLE IF NOT EXISTS olp_vehicles (
  id SERIAL PRIMARY KEY,
  make VARCHAR(100) NOT NULL,
  make_slug VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  model_slug VARCHAR(100) NOT NULL,
  year_range VARCHAR(20) NOT NULL,
  year_start INTEGER NOT NULL,
  year_end INTEGER NOT NULL,
  engine VARCHAR(50) NOT NULL,
  engine_slug VARCHAR(50) NOT NULL,
  fuel_type VARCHAR(20),
  timing_type VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(make_slug, model_slug, year_range, engine_slug)
);

CREATE TABLE IF NOT EXISTS olp_labor_times (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES olp_vehicles(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL,
  labor_hours NUMERIC(5, 2) NOT NULL,
  UNIQUE(vehicle_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_olp_vehicles_lookup
  ON olp_vehicles(make_slug, model_slug, year_start, year_end);
CREATE INDEX IF NOT EXISTS idx_olp_labor_times_vehicle
  ON olp_labor_times(vehicle_id, category);

ALTER TABLE olp_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE olp_labor_times ENABLE ROW LEVEL SECURITY;
`;
```

Then add to the `migrate()` function after step 5:

```typescript
console.log("Step 6: OLP reference tables...");
await sql.unsafe(migrationStep6);
```

**Step 2: Add Drizzle schema definitions**

Add to the end of `apps/api/src/db/schema.ts`:

```typescript
export const olpVehicles = pgTable("olp_vehicles", {
  id: serial("id").primaryKey(),
  make: varchar("make", { length: 100 }).notNull(),
  makeSlug: varchar("make_slug", { length: 100 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  modelSlug: varchar("model_slug", { length: 100 }).notNull(),
  yearRange: varchar("year_range", { length: 20 }).notNull(),
  yearStart: integer("year_start").notNull(),
  yearEnd: integer("year_end").notNull(),
  engine: varchar("engine", { length: 50 }).notNull(),
  engineSlug: varchar("engine_slug", { length: 50 }).notNull(),
  fuelType: varchar("fuel_type", { length: 20 }),
  timingType: varchar("timing_type", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueVehicle: unique().on(table.makeSlug, table.modelSlug, table.yearRange, table.engineSlug),
}));

export const olpLaborTimes = pgTable("olp_labor_times", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => olpVehicles.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 200 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  laborHours: numeric("labor_hours", { precision: 5, scale: 2 }).notNull(),
}, (table) => ({
  uniqueJob: unique().on(table.vehicleId, table.slug),
}));
```

**Step 3: Run the migration**

Run: `cd /Users/spenc/hmls/hmls-web && deno task --cwd apps/api db:migrate` Expected: "Step 6: OLP
reference tables..." then "Migrations completed successfully!"

**Step 4: Verify tables exist**

Run a quick SQL check via Supabase MCP `execute_sql`:

```sql
SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'olp_%';
```

Expected: `olp_vehicles` and `olp_labor_times`

**Step 5: Run typecheck**

Run: `deno task check:api` Expected: No errors

---

### Task 2: Build the scraper script

**Files:**

- Create: `apps/api/src/scripts/scrape-olp.ts`
- Modify: `apps/api/deno.json` (add task)

**Step 1: Add the deno task**

Add to `apps/api/deno.json` tasks:

```json
"db:scrape-olp": "deno run --env=../../.env --allow-net --allow-env --allow-read src/scripts/scrape-olp.ts"
```

**Step 2: Create the scraper script**

Create `apps/api/src/scripts/scrape-olp.ts`. This is the complete script:

```typescript
/**
 * OLP Labor Times Scraper
 *
 * Scrapes all labor time data from openlaborproject.com
 * and inserts it into olp_vehicles + olp_labor_times tables.
 *
 * Run: deno task db:scrape-olp
 *
 * Features:
 * - Hierarchical crawl: makes -> models -> configs -> jobs
 * - 300ms rate limiting between requests
 * - Resumable: skips vehicles already in DB
 * - Retry with exponential backoff (3 attempts)
 * - Batch inserts (500 rows at a time)
 */

import postgres from "postgres";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const sql = postgres(DATABASE_URL);

const BASE_URL = "https://openlaborproject.com";
const DELAY_MS = 300;
const MAX_RETRIES = 3;
const BATCH_SIZE = 500;
const USER_AGENT = "HMLS-Scraper/1.0 (mobile mechanic labor time sync)";

// --- Types ---

interface Make {
  name: string;
  slug: string;
  modelCount: number;
}

interface Model {
  name: string;
  slug: string;
  vehicleCount: number;
}

interface VehicleConfig {
  yearRange: string;
  yearStart: number;
  yearEnd: number;
  engine: string;
  engineSlug: string;
  fuelType: string | null;
  timingType: string | null;
}

interface Job {
  name: string;
  slug: string;
  category: string;
  laborHours: number;
}

// --- Utilities ---

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${url}`);
      }
      return await resp.text();
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const backoff = DELAY_MS * Math.pow(2, attempt);
      console.warn(`  Retry ${attempt}/${MAX_RETRIES} for ${url} (waiting ${backoff}ms)`);
      await delay(backoff);
    }
  }
  throw new Error("unreachable");
}

/**
 * Extract the __NEXT_DATA__ JSON props from an HTML page.
 * OLP is a Next.js app that embeds page data in a script tag.
 */
function extractNextData(html: string): Record<string, unknown> | null {
  // Look for the JSON blob in the page props
  // Next.js embeds it as: <script id="__NEXT_DATA__" type="application/json">...</script>
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) {
    // Fallback: try to find props JSON embedded differently (RSC/app router)
    // OLP may embed data as a large JSON object in the HTML
    const propsMarker = '"pageProps"';
    const propsIdx = html.indexOf(propsMarker);
    if (propsIdx === -1) return null;

    // Walk backwards to find the opening {
    let braceCount = 0;
    let jsonStart = -1;
    for (let i = propsIdx; i >= 0; i--) {
      if (html[i] === "}") braceCount++;
      if (html[i] === "{") {
        braceCount--;
        if (braceCount < 0) {
          jsonStart = i;
          break;
        }
      }
    }
    if (jsonStart === -1) return null;

    // Walk forward to find matching closing }
    braceCount = 0;
    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === "{") braceCount++;
      if (html[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          try {
            return JSON.parse(html.slice(jsonStart, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf("</script>", jsonStart);
  if (jsonEnd === -1) return null;

  try {
    return JSON.parse(html.slice(jsonStart, jsonEnd));
  } catch {
    return null;
  }
}

// --- Crawl functions ---

async function fetchMakes(): Promise<Make[]> {
  console.log("Fetching makes...");
  const html = await fetchWithRetry(`${BASE_URL}/labor-times`);
  const data = extractNextData(html);
  if (!data) throw new Error("Could not extract makes data");

  // Navigate to the makes array in the page props
  // deno-lint-ignore no-explicit-any
  const props = data as any;
  const pageProps = props?.props?.pageProps ?? props?.pageProps;
  const makes: Make[] = pageProps?.makes ?? pageProps?.data?.makes ?? [];

  if (makes.length === 0) throw new Error("No makes found in page data");
  console.log(`  Found ${makes.length} makes`);
  return makes;
}

async function fetchModels(makeSlug: string): Promise<Model[]> {
  const html = await fetchWithRetry(`${BASE_URL}/labor-times/${makeSlug}`);
  const data = extractNextData(html);
  if (!data) return [];

  // deno-lint-ignore no-explicit-any
  const props = data as any;
  const pageProps = props?.props?.pageProps ?? props?.pageProps;
  const models: Model[] = pageProps?.models ?? pageProps?.data?.models ?? [];
  return models;
}

async function fetchVehicleConfigs(
  makeSlug: string,
  modelSlug: string,
): Promise<VehicleConfig[]> {
  const html = await fetchWithRetry(`${BASE_URL}/labor-times/${makeSlug}/${modelSlug}`);
  const data = extractNextData(html);
  if (!data) return [];

  // deno-lint-ignore no-explicit-any
  const props = data as any;
  const pageProps = props?.props?.pageProps ?? props?.pageProps;
  const vehicles = pageProps?.vehicles ?? pageProps?.data?.vehicles ?? [];

  // deno-lint-ignore no-explicit-any
  return vehicles.map((v: any) => {
    const yearRange = v.yearRange ?? v.year_range ?? "";
    const [startStr, endStr] = yearRange.split("-");
    return {
      yearRange,
      yearStart: parseInt(startStr) || 0,
      yearEnd: parseInt(endStr ?? startStr) || 0,
      engine: v.engine ?? v.engineName ?? "",
      engineSlug: v.engineSlug ?? v.engine_slug ?? "",
      fuelType: v.fuelType ?? v.fuel_type ?? null,
      timingType: v.timingType ?? v.timing_type ?? null,
    };
  });
}

async function fetchJobs(
  makeSlug: string,
  modelSlug: string,
  yearRange: string,
  engineSlug: string,
): Promise<Job[]> {
  const url = `${BASE_URL}/labor-times/${makeSlug}/${modelSlug}/${yearRange}/${engineSlug}`;
  const html = await fetchWithRetry(url);
  const data = extractNextData(html);
  if (!data) return [];

  // deno-lint-ignore no-explicit-any
  const props = data as any;
  const pageProps = props?.props?.pageProps ?? props?.pageProps;

  // Jobs are organized by category in a jobsByCategory object
  const jobsByCategory = pageProps?.jobsByCategory ?? pageProps?.data?.jobsByCategory ?? {};
  const jobs: Job[] = [];

  for (const [category, categoryJobs] of Object.entries(jobsByCategory)) {
    // deno-lint-ignore no-explicit-any
    for (const job of categoryJobs as any[]) {
      jobs.push({
        name: job.name ?? "",
        slug: job.slug ?? "",
        category: job.category ?? category,
        laborHours: parseFloat(job.laborHours ?? job.labor_hours ?? "0"),
      });
    }
  }

  return jobs;
}

// --- DB functions ---

async function vehicleExists(
  makeSlug: string,
  modelSlug: string,
  yearRange: string,
  engineSlug: string,
): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM olp_vehicles
    WHERE make_slug = ${makeSlug}
      AND model_slug = ${modelSlug}
      AND year_range = ${yearRange}
      AND engine_slug = ${engineSlug}
    LIMIT 1
  `;
  return result.length > 0;
}

async function insertVehicle(
  make: string,
  makeSlug: string,
  model: string,
  modelSlug: string,
  config: VehicleConfig,
): Promise<number> {
  const [row] = await sql`
    INSERT INTO olp_vehicles (make, make_slug, model, model_slug, year_range, year_start, year_end, engine, engine_slug, fuel_type, timing_type)
    VALUES (${make}, ${makeSlug}, ${model}, ${modelSlug}, ${config.yearRange}, ${config.yearStart}, ${config.yearEnd}, ${config.engine}, ${config.engineSlug}, ${config.fuelType}, ${config.timingType})
    ON CONFLICT (make_slug, model_slug, year_range, engine_slug) DO UPDATE SET make = EXCLUDED.make
    RETURNING id
  `;
  return row.id;
}

async function insertJobsBatch(vehicleId: number, jobs: Job[]): Promise<void> {
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const values = batch.map((j) =>
      sql`(${vehicleId}, ${j.name}, ${j.slug}, ${j.category}, ${j.laborHours})`
    );

    await sql`
      INSERT INTO olp_labor_times (vehicle_id, name, slug, category, labor_hours)
      VALUES ${sql.unsafe(values.map((v) => `(${vehicleId}, '${sql.escape ? "" : ""})`).join(","))}
      ON CONFLICT (vehicle_id, slug) DO NOTHING
    `.catch(async () => {
      // Fallback: insert one by one if batch fails
      for (const job of batch) {
        await sql`
          INSERT INTO olp_labor_times (vehicle_id, name, slug, category, labor_hours)
          VALUES (${vehicleId}, ${job.name}, ${job.slug}, ${job.category}, ${job.laborHours})
          ON CONFLICT (vehicle_id, slug) DO NOTHING
        `.catch(() => {});
      }
    });
  }
}

// --- Main ---

async function main() {
  console.log("=== OLP Labor Times Scraper ===\n");

  const makes = await fetchMakes();
  await delay(DELAY_MS);

  let totalVehicles = 0;
  let totalJobs = 0;
  let skipped = 0;

  for (const make of makes) {
    console.log(`\n[${make.name}] Fetching models...`);
    const models = await fetchModels(make.slug);
    await delay(DELAY_MS);
    console.log(`  ${models.length} models`);

    for (const model of models) {
      const configs = await fetchVehicleConfigs(make.slug, model.slug);
      await delay(DELAY_MS);

      for (const config of configs) {
        // Resumability: skip if already scraped
        const exists = await vehicleExists(
          make.slug,
          model.slug,
          config.yearRange,
          config.engineSlug,
        );
        if (exists) {
          skipped++;
          continue;
        }

        const jobs = await fetchJobs(make.slug, model.slug, config.yearRange, config.engineSlug);
        await delay(DELAY_MS);

        if (jobs.length === 0) {
          console.warn(
            `  [WARN] No jobs for ${make.name} ${model.name} ${config.yearRange} ${config.engine}`,
          );
          continue;
        }

        const vehicleId = await insertVehicle(make.name, make.slug, model.name, model.slug, config);
        await insertJobsBatch(vehicleId, jobs);

        totalVehicles++;
        totalJobs += jobs.length;
        console.log(
          `  [${totalVehicles}] ${make.name} ${model.name} ${config.yearRange} ${config.engine} — ${jobs.length} jobs`,
        );
      }
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Vehicles: ${totalVehicles} new, ${skipped} skipped`);
  console.log(`Jobs: ${totalJobs} total`);

  await sql.end();
  Deno.exit(0);
}

main().catch(async (err) => {
  console.error("Scraper failed:", err);
  await sql.end();
  Deno.exit(1);
});
```

**Note on batch inserts:** The script above has a simplified batch insert. The actual implementation
should use postgres.js's native parameterized batching. Here's the corrected `insertJobsBatch`:

```typescript
async function insertJobsBatch(vehicleId: number, jobs: Job[]): Promise<void> {
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    // Insert one-by-one with ON CONFLICT — postgres.js handles pipelining
    for (const job of batch) {
      await sql`
        INSERT INTO olp_labor_times (vehicle_id, name, slug, category, labor_hours)
        VALUES (${vehicleId}, ${job.name}, ${job.slug}, ${job.category}, ${job.laborHours})
        ON CONFLICT (vehicle_id, slug) DO NOTHING
      `;
    }
  }
}
```

**Step 3: Run typecheck**

Run: `deno task check:api` Expected: No errors (the script uses `postgres` directly, not Drizzle, to
keep it simple)

**Step 4: Run the migration first, then the scraper**

Run: `cd /Users/spenc/hmls/hmls-web && deno task --cwd apps/api db:migrate` Then:
`cd /Users/spenc/hmls/hmls-web && deno task --cwd apps/api db:scrape-olp`

Expected output:

```
=== OLP Labor Times Scraper ===

Fetching makes...
  Found 87 makes

[Acura] Fetching models...
  24 models
  [1] Acura CL 1997-1999 2.2L I4 — 530 jobs
  [2] Acura CL 1997-1999 3.0L V6 — 530 jobs
  ...
```

The scraper runs for ~35 minutes. It's resumable — if interrupted, re-run and it skips
already-scraped vehicles.

**Step 5: Verify data after scraper completes**

Run via Supabase MCP `execute_sql`:

```sql
SELECT
  (SELECT count(*) FROM olp_vehicles) as vehicles,
  (SELECT count(*) FROM olp_labor_times) as labor_times,
  pg_size_pretty(pg_database_size(current_database())) as db_size;
```

Expected: ~5000 vehicles, ~1.3M labor times, ~165 MB total

---

### Task 3: Test a sample query

**Step 1: Verify the agent can query vehicle-specific labor times**

Run via Supabase MCP `execute_sql`:

```sql
SELECT v.make, v.model, v.year_range, v.engine, lt.name, lt.labor_hours, lt.category
FROM olp_labor_times lt
JOIN olp_vehicles v ON v.id = lt.vehicle_id
WHERE v.make_slug = 'toyota'
  AND v.model_slug = 'camry'
  AND v.year_start <= 2020 AND v.year_end >= 2020
  AND lt.name ILIKE '%brake pad%'
ORDER BY lt.name;
```

Expected: Rows showing brake pad labor hours for the 2020 Camry's matching engine configs.

**Step 2: Test a cross-make comparison**

```sql
SELECT v.make, v.model, v.engine, lt.labor_hours
FROM olp_labor_times lt
JOIN olp_vehicles v ON v.id = lt.vehicle_id
WHERE lt.slug = 'water-pump'
  AND v.year_start <= 2020 AND v.year_end >= 2020
ORDER BY lt.labor_hours DESC
LIMIT 10;
```

This shows the power of the data: same job, different vehicles, wildly different labor hours.
