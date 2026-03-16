import { z } from "zod";
import { toolResult } from "@hmls/shared/tool-result";

// ── RockAuto AJAX API client ──
// Uses the internal catalogapi.php endpoint (same as the browser's JS)
// instead of scraping full HTML pages. Smaller payloads, JSON responses,
// and _nck token for CAPTCHA bypass.

const CATALOG_API = "https://www.rockauto.com/catalog/catalogapi.php";
const CATALOG_BASE = "https://www.rockauto.com/en/catalog";
const HOMEPAGE = "https://www.rockauto.com/";

const USER_AGENTS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

let lastRequestAt = 0;
const MIN_REQUEST_GAP_MS = 1500;

// Serialize outgoing requests so concurrent callers don't bypass the rate limit
let requestChain: Promise<void> = Promise.resolve();

// ── Session management (_nck token) ──

let sessionToken: string | null = null;
let sessionTokenAt = 0;
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
let sessionCookies: string[] = [];
let sessionUserAgent = USER_AGENTS[0];

// Lock to prevent concurrent session initialization races in Deno Deploy
let sessionInitLock: Promise<string> | null = null;

async function ensureSession(): Promise<string> {
  if (sessionToken && Date.now() - sessionTokenAt < SESSION_TTL) {
    return sessionToken;
  }

  // Coalesce concurrent callers onto a single refresh
  if (sessionInitLock) return sessionInitLock;

  sessionInitLock = refreshSession().finally(() => {
    sessionInitLock = null;
  });
  return sessionInitLock;
}

async function refreshSession(): Promise<string> {
  sessionUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const res = await fetch(HOMEPAGE, {
    headers: {
      "User-Agent": sessionUserAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });

  const html = await res.text();

  // Extract _nck token — it's in hidden form fields: <input type="hidden" name="_nck" value="...">
  // Multiple forms may have it; grab the longest token (the full one, not the truncated currency form one)
  const nckMatches = [...html.matchAll(/name="_nck"\s+value="([^"]+)"/g)];

  if (nckMatches.length === 0) {
    throw new Error("Failed to extract _nck token from RockAuto homepage");
  }

  // Use the longest token value (some forms have truncated versions)
  sessionToken = nckMatches.reduce(
    (longest, m) => m[1].length > longest.length ? m[1] : longest,
    "",
  );
  sessionTokenAt = Date.now();

  // Capture cookies from response
  const setCookies = res.headers.getSetCookie?.() ?? [];
  sessionCookies = setCookies.map((c) => c.split(";")[0]);

  return sessionToken;
}

// ── AJAX request helper ──

interface NavnodeFetchResponse {
  html_fill_sections?: Record<string, string>;
  [key: string]: unknown;
}

async function navnodeFetch(
  jsn: Record<string, unknown>,
  _maxGroupIndex = 500,
): Promise<NavnodeFetchResponse> {
  // Serialize through request chain to enforce rate limit across concurrent callers
  await new Promise<void>((resolve) => {
    requestChain = requestChain.then(async () => {
      const now = Date.now();
      const wait = MIN_REQUEST_GAP_MS - (now - lastRequestAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequestAt = Date.now();
      resolve();
    });
  });

  const token = await ensureSession();
  const jnck = encodeURIComponent(token);

  const payload = JSON.stringify({ jsn });
  const body = new URLSearchParams({
    func: "navnode_fetch",
    payload,
    api_json_request: "1",
    _jnck: jnck,
  });

  const cookieHeader = [
    ...sessionCookies,
    "jsEnabled=1",
    "mkt_US=true",
    "mkt_CA=false",
    "mkt_MX=false",
  ].join("; ");

  const res = await fetch(CATALOG_API, {
    method: "POST",
    headers: {
      "User-Agent": sessionUserAgent,
      "Accept": "text/plain, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": "https://www.rockauto.com/",
      "Origin": "https://www.rockauto.com",
      "Cookie": cookieHeader,
      "sec-ch-ua": '"Chromium";v="131", "Not;A=Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`catalogapi.php returned ${res.status}`);
  }

  const text = await res.text();

  // Response is JSON (may have HTML fragments embedded)
  try {
    return JSON.parse(text) as NavnodeFetchResponse;
  } catch {
    // Sometimes the response is raw HTML (fallback)
    return { html_fill_sections: { raw: text } };
  }
}

// ── Simple HTML page fetch (for engine resolution) ──

async function fetchPage(path: string): Promise<string> {
  // Serialize through request chain to enforce rate limit across concurrent callers
  await new Promise<void>((resolve) => {
    requestChain = requestChain.then(async () => {
      const now = Date.now();
      const wait = MIN_REQUEST_GAP_MS - (now - lastRequestAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequestAt = Date.now();
      resolve();
    });
  });

  await ensureSession();

  const cookieHeader = [
    ...sessionCookies,
    "jsEnabled=1",
    "mkt_US=true",
  ].join("; ");

  const res = await fetch(`https://www.rockauto.com${path}`, {
    headers: {
      "User-Agent": sessionUserAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Referer": "https://www.rockauto.com/",
      "Cookie": cookieHeader,
    },
  });

  if (!res.ok) throw new Error(`RockAuto ${path} returned ${res.status}`);
  return res.text();
}

// ── Vehicle engine resolution ──

interface EngineCacheEntry {
  engineSlug: string;
  carcode: string;
  engineName: string;
  cachedAt: number;
}

const engineCache = new Map<string, EngineCacheEntry>();
const ENGINE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

async function resolveEngine(
  year: number,
  make: string,
  model: string,
): Promise<EngineCacheEntry | null> {
  const cacheKey = `${year}|${make}|${model}`.toLowerCase();
  const cached = engineCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < ENGINE_CACHE_TTL) {
    return cached;
  }

  const makeLower = make.toLowerCase();
  const modelLower = model.toLowerCase();

  // Try AJAX approach first: navnode_fetch for model page
  try {
    const response = await navnodeFetch({
      tab: "catalog",
      idepth: 1,
      make: make.toUpperCase(),
      year: String(year),
      model: model.toUpperCase(),
      nodetype: "model",
      jsdata: {
        markets: [{ c: "US", y: "Y", i: "Y" }],
        mktlist: "US",
        showForMarkets: { US: true },
        importanceByMarket: { US: "Y" },
        Show: 1,
      },
      label: `${make.toUpperCase()} ${year} ${model.toUpperCase()}`,
      href: `${CATALOG_BASE}/${makeLower},${year},${modelLower}`,
      loaded: false,
      expand_after_load: true,
      fetching: true,
    });

    // Parse engine links from the AJAX HTML fragments
    const htmlContent = Object.values(response.html_fill_sections ?? {}).join("");
    if (htmlContent) {
      const engines = parseEnginesFromHtml(htmlContent, makeLower, year, modelLower);
      if (engines.length > 0) {
        const preferred = pickPreferredEngine(engines);
        const entry: EngineCacheEntry = { ...preferred, cachedAt: Date.now() };
        engineCache.set(cacheKey, entry);
        return entry;
      }
    }
  } catch (err) {
    console.warn("[parts-lookup] AJAX engine resolution failed, falling back to page fetch:", err);
  }

  // Fallback: fetch the catalog page directly
  try {
    const html = await fetchPage(`/en/catalog/${makeLower},${year},${modelLower}`);
    const engines = parseEnginesFromHtml(html, makeLower, year, modelLower);
    if (engines.length === 0) return null;

    const preferred = pickPreferredEngine(engines);
    const entry: EngineCacheEntry = { ...preferred, cachedAt: Date.now() };
    engineCache.set(cacheKey, entry);
    return entry;
  } catch (err) {
    console.error("[parts-lookup] Engine resolution failed:", err);
    return null;
  }
}

function parseEnginesFromHtml(
  html: string,
  makeLower: string,
  year: number,
  modelLower: string,
): { engineSlug: string; carcode: string; engineName: string }[] {
  const enginePattern = new RegExp(
    `/en/catalog/${makeLower},${year},${modelLower},([^,]+),(\\d+)`,
    "gi",
  );
  const engines: { engineSlug: string; carcode: string; engineName: string }[] = [];
  const seen = new Set<string>();
  let match;

  while ((match = enginePattern.exec(html)) !== null) {
    const slug = match[1];
    const carcode = match[2];
    const key = `${slug}|${carcode}`;
    if (!seen.has(key)) {
      seen.add(key);
      engines.push({
        engineSlug: slug,
        carcode,
        engineName: decodeURIComponent(slug.replace(/\+/g, " ")).toUpperCase(),
      });
    }
  }

  return engines;
}

function pickPreferredEngine(
  engines: { engineSlug: string; carcode: string; engineName: string }[],
): { engineSlug: string; carcode: string; engineName: string } {
  return engines.find(
    (e) =>
      !e.engineName.includes("ELECTRIC") &&
      !e.engineName.includes("CNG") &&
      !e.engineName.includes("HYBRID"),
  ) ?? engines[0];
}

// ── Part name → parttype ID mapping ──
// Maps common service parts to their RockAuto parttype IDs (used in navnode_fetch).

const PARTTYPE_MAP: Record<string, { id: string; label: string }[]> = {
  "oil filter": [{ id: "5340", label: "Oil Filter" }],
  "air filter": [{ id: "5308", label: "Air Filter" }],
  "cabin air filter": [{ id: "10346", label: "Cabin Air Filter" }],
  "brake pad": [{ id: "1684", label: "Brake Pad" }],
  "brake pads": [{ id: "1684", label: "Brake Pad" }],
  "brake pads front": [{ id: "1684", label: "Brake Pad" }],
  "brake pads rear": [{ id: "1684", label: "Brake Pad" }],
  "rotor": [{ id: "1896", label: "Rotor" }],
  "brake rotor": [{ id: "1896", label: "Rotor" }],
  "rotors": [{ id: "1896", label: "Rotor" }],
  "caliper": [{ id: "1704", label: "Caliper" }],
  "alternator": [{ id: "1544", label: "Alternator" }],
  "battery": [{ id: "1556", label: "Battery" }],
  "starter": [{ id: "4152", label: "Starter" }],
  "spark plug": [{ id: "5336", label: "Spark Plug" }],
  "spark plugs": [{ id: "5336", label: "Spark Plug" }],
  "ignition coil": [{ id: "7060", label: "Ignition Coil" }],
  "water pump": [{ id: "1228", label: "Water Pump" }],
  "thermostat": [{ id: "1244", label: "Thermostat & Housing" }],
  "radiator": [{ id: "1210", label: "Radiator" }],
  "serpentine belt": [{ id: "15058", label: "Serpentine Belt" }],
  "drive belt": [{ id: "15058", label: "Serpentine Belt" }],
  "timing belt": [{ id: "5124", label: "Timing Belt" }],
  "wheel bearing": [{ id: "1672", label: "Wheel Bearing" }],
  "tie rod": [{ id: "2380", label: "Tie Rod End" }],
  "ball joint": [{ id: "2092", label: "Ball Joint" }],
  "strut": [{ id: "7584", label: "Strut Assembly" }],
  "shock": [{ id: "2184", label: "Shock Absorber" }],
  "control arm": [{ id: "10396", label: "Control Arm" }],
  "cv axle": [{ id: "12758", label: "CV Axle Assembly" }],
  "fuel pump": [{ id: "5270", label: "Fuel Pump" }],
  "fuel filter": [{ id: "5252", label: "Fuel Filter" }],
  "oxygen sensor": [{ id: "5132", label: "Oxygen Sensor" }],
  "o2 sensor": [{ id: "5132", label: "Oxygen Sensor" }],
  "catalytic converter": [{ id: "5808", label: "Catalytic Converter" }],
  "muffler": [{ id: "1408", label: "Muffler" }],
  "wiper blade": [{ id: "1372", label: "Wiper Blade" }],
  "wiper blades": [{ id: "1372", label: "Wiper Blade" }],
  "headlight bulb": [{ id: "1600", label: "Headlight Bulb" }],
  "brake fluid": [{ id: "11389", label: "Brake Fluid" }],
  "transmission fluid": [{ id: "13530", label: "Transmission Fluid" }],
  "coolant": [{ id: "11454", label: "Coolant" }],
  "power steering fluid": [{ id: "13529", label: "Power Steering Fluid" }],
  "motor oil": [{ id: "12114", label: "Motor Oil" }],
  "engine oil": [{ id: "12114", label: "Motor Oil" }],
  "oil": [{ id: "12114", label: "Motor Oil" }],
  "hub assembly": [{ id: "7584", label: "Wheel Hub Assembly" }],
  "wheel hub": [{ id: "7584", label: "Wheel Hub Assembly" }],
  "ac compressor": [{ id: "6544", label: "A/C Compressor" }],
  "a/c compressor": [{ id: "6544", label: "A/C Compressor" }],
  "power steering pump": [{ id: "2352", label: "Power Steering Pump" }],
  "serpentine belt tensioner": [{ id: "15062", label: "Belt Tensioner" }],
  "belt tensioner": [{ id: "15062", label: "Belt Tensioner" }],
  "idler pulley": [{ id: "15064", label: "Idler Pulley" }],
  "sway bar link": [{ id: "10398", label: "Sway Bar Link" }],
  "stabilizer bar link": [{ id: "10398", label: "Sway Bar Link" }],
  "brake caliper bracket": [{ id: "1706", label: "Caliper Bracket" }],
  "brake hose": [{ id: "1748", label: "Brake Hose" }],
  "exhaust manifold": [{ id: "1388", label: "Exhaust Manifold" }],
  "intake manifold": [{ id: "10180", label: "Intake Manifold" }],
  "valve cover gasket": [{ id: "5070", label: "Valve Cover Gasket" }],
  "head gasket": [{ id: "5038", label: "Head Gasket" }],
  "oil pan gasket": [{ id: "5054", label: "Oil Pan Gasket" }],
  "water pump gasket": [{ id: "1230", label: "Water Pump Gasket" }],
};

function findParttypes(partName: string): { id: string; label: string }[] | null {
  const lower = partName.toLowerCase().trim();

  // Exact match
  if (PARTTYPE_MAP[lower]) return PARTTYPE_MAP[lower];

  // Partial match
  for (const [key, types] of Object.entries(PARTTYPE_MAP)) {
    if (lower.includes(key) || key.includes(lower)) {
      return types;
    }
  }

  return null;
}

// ── Parts fetching via AJAX ──

async function fetchPartsForParttype(
  carcode: string,
  parttypeId: string,
  make: string,
  year: number,
  model: string,
  engineSlug: string,
): Promise<PartResult[]> {
  try {
    const response = await navnodeFetch({
      carcode,
      parttype: parttypeId,
      tab: "catalog",
      idepth: 8,
      nodetype: "parttype",
      jsdata: {
        markets: [{ c: "US", y: "Y", i: "Y" }],
        mktlist: "US",
        showForMarkets: { US: true },
        importanceByMarket: { US: "Y" },
        Show: 1,
      },
      href:
        `${CATALOG_BASE}/${make.toLowerCase()},${year},${model.toLowerCase()},${engineSlug},${carcode}`,
      loaded: false,
      expand_after_load: true,
      fetching: true,
    });

    const htmlContent = Object.values(response.html_fill_sections ?? {}).join("");
    if (htmlContent) {
      return parsePartsFromHtml(htmlContent);
    }
  } catch (err) {
    console.warn(`[parts-lookup] AJAX parts fetch failed for parttype ${parttypeId}:`, err);
  }

  // Fallback: direct page fetch
  const makeLower = make.toLowerCase();
  const modelLower = model.toLowerCase();
  // Build the catalog URL using the old path pattern to find the right page
  const fallbackPaths = buildFallbackPaths(
    makeLower,
    year,
    modelLower,
    engineSlug,
    carcode,
    parttypeId,
  );

  for (const path of fallbackPaths) {
    try {
      const html = await fetchPage(path);
      const parts = parsePartsFromHtml(html);
      if (parts.length > 0) return parts;
    } catch {
      // Try next path
    }
  }

  return [];
}

function buildFallbackPaths(
  make: string,
  year: number,
  model: string,
  engineSlug: string,
  carcode: string,
  parttypeId: string,
): string[] {
  // The old URL pattern includes category+subcategory slugs which we may not have.
  // Try a direct parttype-based path.
  return [
    `/en/catalog/${make},${year},${model},${engineSlug},${carcode},*,*,${parttypeId}`,
  ];
}

// ── HTML parsing for parts listings ──
// Works on both full pages and AJAX HTML fragments.

interface PartResult {
  brand: string;
  partNumber: string;
  description: string;
  price: number;
  coreCharge: number;
  tier: string;
}

function parsePartsFromHtml(html: string): PartResult[] {
  const results: PartResult[] = [];

  // Tier headers
  const tierPositions: { pos: number; tier: string }[] = [];
  const tierPattern = /listing-sortgroupheader[^>]*>([^<]*)</gi;
  let m;
  while ((m = tierPattern.exec(html)) !== null) {
    const label = m[1].replace(/&nbsp;/g, "").trim().toLowerCase();
    let tier = "Standard";
    if (label.includes("economy")) tier = "Economy";
    else if (label.includes("standard") || label.includes("daily") || label.includes("good")) {
      tier = "Daily Driver";
    } else if (
      label.includes("performance") || label.includes("heavy") || label.includes("premium") ||
      label.includes("best")
    ) {
      tier = "Premium";
    }
    tierPositions.push({ pos: m.index, tier });
  }

  function getTierAtPosition(pos: number): string {
    let tier = "Standard";
    for (const tp of tierPositions) {
      if (tp.pos < pos) tier = tp.tier;
      else break;
    }
    return tier;
  }

  // Find listing containers — supports both numeric IDs and __GIP__ placeholders
  // Numeric: listingcontainer[8]  |  AJAX: listingcontainer[__GIP__8__]
  const containerPattern = /id="listingcontainer\[([^\]]+)\]"/g;
  const containerIds: { id: string; pos: number }[] = [];
  while ((m = containerPattern.exec(html)) !== null) {
    containerIds.push({ id: m[1], pos: m.index });
  }

  for (let i = 0; i < containerIds.length; i++) {
    const container = containerIds[i];
    const n = container.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // Escape for regex
    const startPos = container.pos;
    const endPos = containerIds[i + 1]?.pos ?? startPos + 5000;
    const block = html.substring(startPos, endPos);

    // Brand
    const brandMatch = block.match(/listing-final-manufacturer[^>]*>([^<]+)</);
    const brand = brandMatch?.[1]?.trim() ?? "";

    // Part number
    const partNumMatch = block.match(/listing-final-partnumber[^>]*>([^<]+)</) ??
      block.match(new RegExp(`vew_partnumber\\[${n}\\][^>]*>([^<]+)<`));
    const partNumber = partNumMatch?.[1]?.trim() ?? "";

    // Price — multiple patterns (ID-specific first, then generic $ fallback)
    const priceMatch = block.match(new RegExp(`dprice\\[${n}\\]\\[v\\][^>]*>\\(?\\$?([\\d,.]+)`)) ??
      block.match(/\$(\d+[\d,.]*)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(",", "")) : 0;

    // Core charge
    const coreMatch = block.match(
      new RegExp(`listingtd\\[${n}\\]\\[core\\][^>]*>[^$]*\\$([\\d,.]+)`),
    );
    const coreCharge = coreMatch ? parseFloat(coreMatch[1].replace(",", "")) : 0;

    // Description/fitment
    const descMatch = block.match(/listing-footnote-text[^>]*>([^<]+)</);
    const description = descMatch?.[1]?.trim() ?? "";

    const tier = getTierAtPosition(startPos);

    if (brand && price > 0) {
      results.push({ brand, partNumber, description, price, coreCharge, tier });
    }
  }

  return results;
}

// ── Cache ──

interface PartsCacheEntry {
  results: PartResult[];
  cachedAt: number;
}

const partsCache = new Map<string, PartsCacheEntry>();
const PARTS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── Tool definition ──

export const lookupPartsPrice = {
  name: "lookup_parts_price",
  description: "Look up real parts pricing from RockAuto's catalog for a specific vehicle. " +
    "Returns the recommended PREMIUM tier price to use in estimates. " +
    "Use this BEFORE creating estimates to get accurate parts costs instead of guessing. " +
    "Always use the recommendedPrice field as partsCost in create_estimate. " +
    "Supports 50+ part types: oil filter, brake pads, rotors, alternator, spark plugs, " +
    "motor oil, AC compressor, power steering pump, gaskets, sensors, and more.",
  schema: z.object({
    year: z.number().describe("Vehicle year, e.g. 2015"),
    make: z.string().describe("Vehicle make, e.g. 'Honda'"),
    model: z.string().describe("Vehicle model, e.g. 'Civic'"),
    partName: z
      .string()
      .describe(
        "Part to search for, e.g. 'oil filter', 'brake pads', 'alternator', 'motor oil'",
      ),
  }),
  execute: async (
    params: { year: number; make: string; model: string; partName: string },
    _ctx: unknown,
  ) => {
    const vehicle = `${params.year} ${params.make} ${params.model}`;

    // Check cache
    const cacheKey = `${vehicle}|${params.partName}`.toLowerCase();
    const cached = partsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < PARTS_CACHE_TTL) {
      return formatResults(vehicle, params.partName, cached.results);
    }

    // Find parttype IDs for this part
    const parttypes = findParttypes(params.partName);
    if (!parttypes) {
      return toolResult({
        found: false,
        vehicle,
        partName: params.partName,
        message: `"${params.partName}" is not in our parts catalog mapping. ` +
          "Estimate parts cost based on industry knowledge. " +
          "Supported: oil filter, air filter, brake pads, rotors, alternator, starter, " +
          "spark plugs, water pump, radiator, struts, motor oil, AC compressor, gaskets, and more.",
      });
    }

    try {
      // Step 1: Resolve vehicle engine
      const engine = await resolveEngine(params.year, params.make, params.model);
      if (!engine) {
        return toolResult({
          found: false,
          vehicle,
          partName: params.partName,
          message:
            "Vehicle not found on RockAuto. Estimate parts cost based on industry knowledge.",
        });
      }

      // Step 2: Fetch parts for each parttype via AJAX
      const allResults: PartResult[] = [];

      for (const pt of parttypes) {
        const parts = await fetchPartsForParttype(
          engine.carcode,
          pt.id,
          params.make,
          params.year,
          params.model,
          engine.engineSlug,
        );
        allResults.push(...parts);
      }

      // Cache results
      partsCache.set(cacheKey, { results: allResults, cachedAt: Date.now() });

      return formatResults(vehicle, params.partName, allResults);
    } catch (error) {
      console.error(`[parts-lookup] Error looking up "${params.partName}":`, error);
      return toolResult({
        found: false,
        vehicle,
        partName: params.partName,
        message: "Parts lookup failed. Estimate parts cost based on industry knowledge.",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

// ── Result formatting ──

function formatResults(
  vehicle: string,
  partName: string,
  results: PartResult[],
) {
  if (results.length === 0) {
    return toolResult({
      found: false,
      vehicle,
      partName,
      message:
        "No parts found on RockAuto for this search. Estimate parts cost based on industry knowledge.",
    });
  }

  const premium = results.filter((r) => r.tier === "Premium").sort((a, b) => a.price - b.price);
  const daily = results
    .filter((r) => r.tier === "Daily Driver" || r.tier === "Standard")
    .sort((a, b) => a.price - b.price);
  const economy = results.filter((r) => r.tier === "Economy").sort((a, b) => a.price - b.price);

  // Always use premium tier for estimates. Fall back to daily driver, then economy.
  const preferredTier = premium.length > 0 ? premium : daily.length > 0 ? daily : economy;
  const recommendedPrice = preferredTier.length > 0
    ? preferredTier[Math.floor(preferredTier.length / 2)].price
    : results[Math.floor(results.length / 2)].price;

  return toolResult({
    found: true,
    vehicle,
    partName,
    recommendedPrice,
    recommendedTier: premium.length > 0 ? "Premium" : daily.length > 0 ? "Daily Driver" : "Economy",
    premium: premium.slice(0, 3).map(formatPart),
    dailyDriver: daily.slice(0, 3).map(formatPart),
    economy: economy.slice(0, 3).map(formatPart),
    totalOptions: results.length,
    note: "ALWAYS use recommendedPrice as partsCost when creating estimates — " +
      "we quote premium tier parts. The system applies our standard markup automatically.",
  });
}

function formatPart(r: PartResult) {
  return {
    brand: r.brand,
    partNumber: r.partNumber,
    price: r.price,
    coreCharge: r.coreCharge > 0 ? r.coreCharge : undefined,
    description: r.description || undefined,
  };
}

export const partsLookupTools = [lookupPartsPrice];
