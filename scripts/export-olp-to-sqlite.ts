#!/usr/bin/env -S deno run -A

/**
 * Export OLP data from Supabase REST API to SQLite.
 * Supports resuming from where it left off.
 */

const SUPABASE_URL = "https://ddkapmjkubklyzuciscd.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRka2FwbWprdWJrbHl6dWNpc2NkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzcyMzQ4NiwiZXhwIjoyMDgzMjk5NDg2fQ.XoNxAvTyMoTtLrzEpZWLgMGnA_FRmU2cCWHWUIql3Ko";

const DB_PATH = Deno.args[0] || "./olp-labor-times.db";
const PAGE_SIZE = 1000;
const MAX_RETRIES = 3;

const { Database } = await import("jsr:@db/sqlite@0.12");

async function supabaseGet(
  table: string,
  params: string,
): Promise<{ data: Record<string, unknown>[]; totalCount: number | null }> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "count=exact",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) {
          console.log(`  Retry ${attempt + 1}/${MAX_RETRIES} (${res.status})...`);
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error(`${res.status}: ${text}`);
      }
      const count = res.headers.get("content-range")?.split("/")[1];
      const data = await res.json();
      return { data, totalCount: count ? parseInt(count) : null };
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) throw e;
      console.log(`  Retry ${attempt + 1}/${MAX_RETRIES}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error("Unreachable");
}

// Open or create SQLite database
let isResume = false;
try {
  Deno.statSync(DB_PATH);
  isResume = true;
} catch { /* new db */ }

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA synchronous=NORMAL");

if (!isResume) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS olp_vehicles (
      id INTEGER PRIMARY KEY,
      make TEXT NOT NULL,
      make_slug TEXT NOT NULL,
      model TEXT NOT NULL,
      model_slug TEXT NOT NULL,
      year_range TEXT NOT NULL,
      year_start INTEGER NOT NULL,
      year_end INTEGER NOT NULL,
      engine TEXT NOT NULL,
      engine_slug TEXT NOT NULL,
      fuel_type TEXT,
      timing_type TEXT
    );
    CREATE TABLE IF NOT EXISTS olp_labor_times (
      id INTEGER PRIMARY KEY,
      vehicle_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      category TEXT NOT NULL,
      labor_hours REAL NOT NULL
    );
  `);
}

// Check existing counts for resume
const existingVehicles = db.prepare("SELECT COUNT(*) as c FROM olp_vehicles").get() as {
  c: number;
};
const existingLabor = db.prepare("SELECT COUNT(*) as c FROM olp_labor_times").get() as {
  c: number;
};
const maxLaborId = db.prepare("SELECT COALESCE(MAX(id), 0) as m FROM olp_labor_times").get() as {
  m: number;
};
const maxVehicleId = db.prepare("SELECT COALESCE(MAX(id), 0) as m FROM olp_vehicles").get() as {
  m: number;
};

console.log(`Existing data: ${existingVehicles.c} vehicles, ${existingLabor.c} labor times`);

// Export vehicles — use id-based cursor instead of offset for resume
const insertVehicle = db.prepare(
  `INSERT OR IGNORE INTO olp_vehicles (id, make, make_slug, model, model_slug, year_range, year_start, year_end, engine, engine_slug, fuel_type, timing_type)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

let lastVehicleId = maxVehicleId.m;
let totalVehicles = existingVehicles.c;
console.log(`Exporting olp_vehicles (resuming from id > ${lastVehicleId})...`);

while (true) {
  const { data: vehicles, totalCount } = await supabaseGet(
    "olp_vehicles",
    `select=*&order=id&limit=${PAGE_SIZE}&id=gt.${lastVehicleId}`,
  );
  if (vehicles.length === 0) break;

  db.exec("BEGIN");
  for (const v of vehicles) {
    insertVehicle.run(
      v.id as number,
      v.make as string,
      v.make_slug as string,
      v.model as string,
      v.model_slug as string,
      v.year_range as string,
      v.year_start as number,
      v.year_end as number,
      v.engine as string,
      v.engine_slug as string,
      (v.fuel_type as string) ?? null,
      (v.timing_type as string) ?? null,
    );
  }
  db.exec("COMMIT");

  totalVehicles += vehicles.length;
  lastVehicleId = vehicles[vehicles.length - 1].id as number;
  console.log(`  Vehicles: ${totalVehicles}/${totalCount ?? "?"} (last id: ${lastVehicleId})`);
  if (vehicles.length < PAGE_SIZE) break;
}
console.log(`  Total vehicles: ${totalVehicles}`);

// Export labor times — id-based cursor for resume
const insertLabor = db.prepare(
  `INSERT OR IGNORE INTO olp_labor_times (id, vehicle_id, name, slug, category, labor_hours)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

// Get total count
const { totalCount: laborCount } = await supabaseGet(
  "olp_labor_times",
  "select=id&limit=1&offset=0",
);
const total = laborCount ?? 0;

let lastLaborId = maxLaborId.m;
let inserted = existingLabor.c;
console.log(
  `Exporting olp_labor_times (resuming from id > ${lastLaborId}, ${inserted}/${total} done)...`,
);

while (true) {
  const { data: batch } = await supabaseGet(
    "olp_labor_times",
    `select=id,vehicle_id,name,slug,category,labor_hours&order=id&limit=${PAGE_SIZE}&id=gt.${lastLaborId}`,
  );

  if (batch.length === 0) break;

  db.exec("BEGIN");
  for (const lt of batch) {
    insertLabor.run(
      lt.id as number,
      lt.vehicle_id as number,
      lt.name as string,
      lt.slug as string,
      lt.category as string,
      parseFloat(String(lt.labor_hours)),
    );
  }
  db.exec("COMMIT");

  inserted += batch.length;
  lastLaborId = batch[batch.length - 1].id as number;

  if (inserted % 50000 < PAGE_SIZE) {
    const pct = total > 0 ? ((inserted / total) * 100).toFixed(1) : "?";
    console.log(`  ${inserted}/${total} (${pct}%) [last id: ${lastLaborId}]`);
  }

  if (batch.length < PAGE_SIZE) break;
}

// Build indexes (IF NOT EXISTS for resume safety)
console.log("Building indexes...");
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_vehicles_make_model ON olp_vehicles(make, model);
  CREATE INDEX IF NOT EXISTS idx_vehicles_year ON olp_vehicles(year_start, year_end);
  CREATE INDEX IF NOT EXISTS idx_labor_vehicle ON olp_labor_times(vehicle_id);
  CREATE INDEX IF NOT EXISTS idx_labor_category ON olp_labor_times(category);
  CREATE INDEX IF NOT EXISTS idx_labor_name ON olp_labor_times(name);
`);

console.log(
  `\nDone! Total: ${totalVehicles} vehicles + ${inserted} labor times`,
);
console.log(`SQLite file: ${DB_PATH}`);

const stat = Deno.statSync(DB_PATH);
console.log(`File size: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

db.close();
