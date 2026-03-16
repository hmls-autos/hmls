import { Database } from "@db/sqlite";

const OLP_DB_PATH = "/tmp/olp-labor-times.db";
const R2_URL = Deno.env.get("OLP_SQLITE_URL") ?? "";

let _db: Database | null = null;
let _downloadPromise: Promise<Database> | null = null;

/**
 * Get the OLP SQLite database, downloading from R2 on first access.
 * Uses a promise lock to prevent concurrent downloads.
 */
export async function getOlpDb(): Promise<Database> {
  if (_db) return _db;
  if (_downloadPromise) return _downloadPromise;

  _downloadPromise = _initDb();
  try {
    const db = await _downloadPromise;
    return db;
  } catch (e) {
    _downloadPromise = null;
    throw e;
  }
}

const DOWNLOAD_TIMEOUT_MS = 300_000; // 5 minutes — allows for slow cold-start downloads of large DB files
const MAX_RETRIES = 3;

async function _initDb(): Promise<Database> {
  // Check if already downloaded
  try {
    const stat = Deno.statSync(OLP_DB_PATH);
    if (stat.size > 0) {
      _db = new Database(OLP_DB_PATH, { readonly: true });
      return _db;
    }
  } catch {
    // Not downloaded yet
  }

  if (!R2_URL) {
    throw new Error(
      "OLP_SQLITE_URL env var not set. Set it to the R2 public URL of olp-labor-times.db",
    );
  }

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Downloading OLP SQLite database from R2 (attempt ${attempt}/${MAX_RETRIES})...`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(R2_URL, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) throw new Error(`Failed to download OLP DB: ${res.status}`);

      const data = new Uint8Array(await res.arrayBuffer());
      await Deno.writeFile(OLP_DB_PATH, data);
      console.log(`OLP database downloaded (${(data.length / 1024 / 1024).toFixed(1)} MB)`);

      _db = new Database(OLP_DB_PATH, { readonly: true });
      return _db;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const isTimeout = lastError.name === "AbortError";
      console.error(
        `OLP download attempt ${attempt} failed${isTimeout ? " (timeout)" : ""}: ${lastError.message}`,
      );
      if (attempt < MAX_RETRIES) {
        const delay = 1000 * attempt;
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        // Remove partial file before retry
        try { await Deno.remove(OLP_DB_PATH); } catch { /* ignore */ }
      }
    }
  }

  throw new Error(`Failed to download OLP DB after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

// --- Query helpers ---

export interface OlpVehicle {
  id: number;
  make: string;
  model: string;
  year_range: string;
  engine: string;
  fuel_type: string | null;
}

export interface OlpLaborTime {
  name: string;
  category: string;
  labor_hours: number;
  vehicle_id: number;
}

export interface OlpCategory {
  category: string;
  count: number;
}

export function findVehicles(
  db: Database,
  make: string,
  model: string,
  year: number,
  fuzzy = false,
): OlpVehicle[] {
  const makePattern = fuzzy ? `%${make}%` : make;
  const modelPattern = fuzzy ? `%${model}%` : model;

  return db
    .prepare(
      `SELECT id, make, model, year_range, engine, fuel_type
       FROM olp_vehicles
       WHERE make LIKE ? COLLATE NOCASE
         AND model LIKE ? COLLATE NOCASE
         AND year_start <= ?
         AND year_end >= ?`,
    )
    .all(makePattern, modelPattern, year, year) as OlpVehicle[];
}

export function searchLaborTimes(
  db: Database,
  vehicleIds: number[],
  serviceWords: string[],
  category: string | undefined,
  matchAny = false,
): OlpLaborTime[] {
  if (vehicleIds.length === 0 || serviceWords.length === 0) return [];

  const placeholders = vehicleIds.map(() => "?").join(",");

  let nameCondition: string;
  if (matchAny) {
    nameCondition = serviceWords
      .map(() => `name LIKE ? COLLATE NOCASE`)
      .join(" OR ");
    nameCondition = `(${nameCondition})`;
  } else {
    nameCondition = serviceWords
      .map(() => `name LIKE ? COLLATE NOCASE`)
      .join(" AND ");
  }

  const categoryCondition = category ? ` AND category LIKE ? COLLATE NOCASE` : "";

  const sql = `SELECT name, category, labor_hours, vehicle_id
     FROM olp_labor_times
     WHERE vehicle_id IN (${placeholders})
       AND ${nameCondition}${categoryCondition}
     LIMIT 30`;

  const params: (string | number)[] = [
    ...vehicleIds,
    ...serviceWords.map((w) => `%${w}%`),
  ];
  if (category) params.push(category);

  return db.prepare(sql).all(...params) as OlpLaborTime[];
}

export function getCategoryBreakdown(
  db: Database,
  vehicleIds: number[],
): OlpCategory[] {
  if (vehicleIds.length === 0) return [];

  const placeholders = vehicleIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT category, COUNT(*) as count
       FROM olp_labor_times
       WHERE vehicle_id IN (${placeholders})
       GROUP BY category
       ORDER BY category`,
    )
    .all(...vehicleIds) as OlpCategory[];
}
