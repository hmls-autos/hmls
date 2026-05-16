// Top-5 OBD-II codes by Google search volume, seeded for the v1 SEO
// matrix (Lane C of the fixo Speed Wedge 30-day推广 plan). Expanded to
// the full 33 codes in OBD_CODES (apps/agent/src/fixo/tools/lookupObdCode.ts)
// only if Week 1 signals validate the wedge.
//
// Why not import OBD_CODES directly? Two reasons:
//   1. apps/agent is Deno + uses Deno-only imports; fixo-web is Bun/Next.
//      Cross-runtime ts module sharing is awkward and not worth the
//      complexity for a 33-entry static dataset.
//   2. SEO pages need fields that don't exist in the agent's OBD_CODES
//      (driveSafetyTier, oneLineVerdict, common-customer-words headline).
//      Those are SEO-copy concerns, not agent-tool concerns.
//
// When OBD_CODES gets a `severity` field upstream, replace this file
// with a generated build-time JSON. Until then, the duplication is
// deliberate.

export type DriveSafetyTier =
  | "ok_to_drive"
  | "drive_cautiously"
  | "do_not_drive";

export interface ObdSeoEntry {
  code: string;
  description: string;
  system: string;
  /** Customer-search-friendly H1, NOT the technical description. */
  headline: string;
  /** Drive-ability verdict — answers "Can I drive with this code?". */
  driveSafetyTier: DriveSafetyTier;
  /** One-sentence verdict, plain English, shown next to the badge. */
  oneLineVerdict: string;
  /** Pulled from OBD_CODES — common root causes. */
  commonRootCauses: string[];
  /** Pulled from OBD_CODES — pinpoint tests. */
  pinpointTests: string[];
  /** Typical national price range for the most common fix, in USD. */
  typicalFixCost: { lowUsd: number; highUsd: number; mostCommonFix: string };
  /** SEO metadata tail — "P0420 Honda" / "P0420 Toyota" search variants. */
  searchVariantHint?: string;
}

export const OBD_SEO_CODES: Record<string, ObdSeoEntry> = {
  P0420: {
    code: "P0420",
    description: "Catalyst System Efficiency Below Threshold (Bank 1)",
    system: "Emissions",
    headline: "Check Engine Light P0420 — Catalytic Converter Warning",
    driveSafetyTier: "ok_to_drive",
    oneLineVerdict:
      "You can keep driving short-term. The car runs normally; you'll only fail an emissions test until it's fixed.",
    commonRootCauses: [
      "aging catalytic converter (most common — usually >100k miles)",
      "failing oxygen sensor downstream of the cat",
      "exhaust leak between the cat and the rear O2 sensor",
      "engine misfire dumping unburned fuel through the cat (compound problem)",
      "incorrect octane / contaminated fuel",
    ],
    pinpointTests: [
      "scan live O2 sensor data — upstream should switch rapidly, downstream should be flat near 0.7V",
      "smoke test the exhaust between the cat and the rear O2 sensor",
      "check for stored or pending misfire codes (P030x)",
      "swap the downstream O2 sensor and retest",
      "physical cat inspection — backpressure test or visible damage",
    ],
    typicalFixCost: {
      lowUsd: 150,
      highUsd: 1800,
      mostCommonFix:
        "downstream O2 sensor replacement OR full catalyst replacement",
    },
    searchVariantHint: "P0420 Honda Civic, P0420 Toyota Camry, P0420 fix cost",
  },

  P0300: {
    code: "P0300",
    description: "Random/Multiple Cylinder Misfire Detected",
    system: "Ignition",
    headline: "P0300 Random Misfire — What It Means & When It's Serious",
    driveSafetyTier: "drive_cautiously",
    oneLineVerdict:
      "Drive short distances only. Misfires dump raw fuel into the catalytic converter and can damage it within days under hard driving.",
    commonRootCauses: [
      "worn spark plugs (most common — check service history first)",
      "failing ignition coil(s)",
      "vacuum leak letting unmetered air into the intake",
      "weak fuel pump or clogged fuel filter",
      "dirty or failing fuel injectors",
      "low compression on one or more cylinders",
    ],
    pinpointTests: [
      "scan misfire counters per cylinder via live data",
      "swap suspect coil + plug to a different cylinder and see if the misfire moves",
      "fuel pressure test — key-on engine off, running, snap-throttle",
      "compression test on cylinders showing misfire counts",
      "smoke test the intake for vacuum leaks",
    ],
    typicalFixCost: {
      lowUsd: 80,
      highUsd: 600,
      mostCommonFix:
        "spark plug + coil pack replacement (DIY-friendly for many makes)",
    },
    searchVariantHint: "P0300 misfire fix, P0300 rough idle, P0300 cold start",
  },

  P0171: {
    code: "P0171",
    description: "System Too Lean (Bank 1)",
    system: "Fuel",
    headline: "P0171 System Too Lean — Common Causes & Fixes",
    driveSafetyTier: "drive_cautiously",
    oneLineVerdict:
      "Safe for short trips. A lean condition can damage the engine over weeks if ignored, especially under load (highway, towing).",
    commonRootCauses: [
      "vacuum leak (most common — split intake hose, leaking gasket, failed PCV)",
      "dirty mass airflow (MAF) sensor",
      "failing fuel pump or restricted fuel filter",
      "clogged fuel injector(s)",
      "exhaust leak before the upstream O2 sensor",
    ],
    pinpointTests: [
      "scan short-term and long-term fuel trim values at idle and 2500 RPM",
      "smoke test the intake for vacuum leaks",
      "clean the MAF sensor with MAF-specific cleaner, recheck",
      "fuel pressure test under load",
      "check exhaust manifold and upstream O2 sensor area for cracks",
    ],
    typicalFixCost: {
      lowUsd: 50,
      highUsd: 700,
      mostCommonFix: "MAF cleaning OR intake gasket replacement",
    },
    searchVariantHint: "P0171 Ford F-150, P0171 vacuum leak, P0171 MAF sensor",
  },

  P0455: {
    code: "P0455",
    description: "Evaporative Emission System Large Leak Detected",
    system: "Emissions / EVAP",
    headline: "P0455 EVAP Leak — Usually Just Your Gas Cap",
    driveSafetyTier: "ok_to_drive",
    oneLineVerdict:
      "Completely safe to drive. EVAP is an emissions system — the car runs normally, and the most common fix is tightening your gas cap.",
    commonRootCauses: [
      "loose, missing, or worn gas cap (60%+ of P0455 cases)",
      "cracked EVAP hose under the vehicle",
      "failing purge or vent solenoid valve",
      "fuel tank seam leak (rare, but expensive)",
    ],
    pinpointTests: [
      "tighten the gas cap until it clicks 3+ times, drive 50 miles, see if code clears",
      "visual + smoke test of all EVAP hoses under the chassis",
      "actuator test on the purge and vent solenoids via scanner",
      "pressure-decay test on the tank itself",
    ],
    typicalFixCost: {
      lowUsd: 0,
      highUsd: 250,
      mostCommonFix: "tighten or replace gas cap ($0–$25 part)",
    },
    searchVariantHint:
      "P0455 gas cap, P0455 EVAP leak, P0455 large leak detected",
  },

  P0128: {
    code: "P0128",
    description: "Coolant Temperature Below Thermostat Regulating Temperature",
    system: "Cooling",
    headline: "P0128 Engine Coolant Won't Heat Up — Usually a Stuck Thermostat",
    driveSafetyTier: "drive_cautiously",
    oneLineVerdict:
      "Safe to drive but fix it soon. A cold-running engine hurts fuel economy 10–15% and increases wear over months.",
    commonRootCauses: [
      "thermostat stuck open (most common — usually under $30 part)",
      "failing engine coolant temperature (ECT) sensor",
      "low coolant level letting the thermostat sit dry",
      "incorrect-temperature thermostat installed previously",
    ],
    pinpointTests: [
      "compare ECT sensor reading at warm idle against an infrared thermometer at the thermostat housing",
      "check coolant level cold; top off and recheck after a heat cycle",
      "watch live coolant temp gauge — should climb to ~195–210°F within 10 minutes",
      "swap the thermostat (cheap part, well-known fix)",
    ],
    typicalFixCost: {
      lowUsd: 80,
      highUsd: 350,
      mostCommonFix: "thermostat + coolant flush",
    },
    searchVariantHint:
      "P0128 thermostat, P0128 coolant temp, P0128 cold engine",
  },
};

export const OBD_SEO_CODES_LIST = Object.values(OBD_SEO_CODES);
