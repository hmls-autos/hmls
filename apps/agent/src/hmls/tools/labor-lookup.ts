import { z } from "zod";
import { toolResult } from "@hmls/shared/tool-result";
import { findVehicles, getCategoryBreakdown, getOlpDb, searchLaborTimes } from "./olp-sqlite.ts";

/**
 * Lookup labor times from OLP (Open Labor Project) reference data.
 * 2.4M+ entries across 4,400+ vehicles — real industry labor guides.
 * Data served from SQLite (downloaded from R2 on first access).
 */
export const lookupLaborTimeTool = {
  name: "lookup_labor_time",
  description: "Look up industry-standard labor times from the Open Labor Project database. " +
    "Use this to get accurate labor hours for a specific vehicle and service. " +
    "Returns labor hours by engine variant. Always use this before generating estimates.",
  schema: z.object({
    year: z.number().describe("Vehicle year, e.g. 2020"),
    make: z.string().describe("Vehicle make, e.g. 'Toyota'"),
    model: z.string().describe("Vehicle model, e.g. 'Camry'"),
    service: z
      .string()
      .describe(
        "Service or job to look up, e.g. 'brake pads', 'oil change', 'alternator'. " +
          "Searches by partial match.",
      ),
    category: z
      .string()
      .optional()
      .describe(
        "Optional category filter: brakes, cooling, electrical, engine, " +
          "exhaust, steering, suspension, transmission, maintenance, other",
      ),
  }),
  execute: async (
    params: {
      year: number;
      make: string;
      model: string;
      service: string;
      category?: string;
    },
    _ctx: unknown,
  ) => {
    const db = await getOlpDb();

    // 1. Find matching vehicles (make + model + year in range)
    let vehicles = findVehicles(db, params.make, params.model, params.year);

    if (vehicles.length === 0) {
      // Try fuzzy make + model match
      vehicles = findVehicles(db, params.make, params.model, params.year, true);

      if (vehicles.length === 0) {
        return toolResult({
          found: false,
          vehicle: `${params.year} ${params.make} ${params.model}`,
          service: params.service,
          message:
            "Vehicle not found in OLP database. Estimate labor hours based on industry knowledge.",
        });
      }
    }

    const vehicleIds = vehicles.map((v) => v.id);

    // 2. Search labor times for matching service
    const serviceWords = params.service
      .split(/\s+/)
      .filter((w) => w.length > 1);

    let laborTimes = searchLaborTimes(
      db,
      vehicleIds,
      serviceWords,
      params.category,
    );

    if (laborTimes.length === 0 && serviceWords.length > 1) {
      // Fallback: try matching ANY word (OR instead of AND)
      laborTimes = searchLaborTimes(
        db,
        vehicleIds,
        serviceWords,
        params.category,
        true,
      );
    }

    if (laborTimes.length === 0) {
      return toolResult({
        found: false,
        vehicle: `${params.year} ${params.make} ${params.model}`,
        service: params.service,
        engines: vehicles.map((v) => v.engine),
        message: `No labor times found for "${params.service}" on this vehicle. ` +
          "Try a broader search term or estimate labor hours based on industry knowledge.",
      });
    }

    // 3. Group results by engine variant
    const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

    const results = laborTimes.map((lt) => {
      const vehicle = vehicleMap.get(lt.vehicle_id);
      return {
        service: lt.name,
        category: lt.category,
        laborHours: Number(lt.labor_hours),
        engine: vehicle?.engine ?? "unknown",
        fuelType: vehicle?.fuel_type ?? null,
      };
    });

    // Deduplicate by service name + engine
    const seen = new Set<string>();
    const deduped = results.filter((r) => {
      const key = `${r.service}|${r.engine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by service name, then engine
    deduped.sort((a, b) => a.service.localeCompare(b.service) || a.engine.localeCompare(b.engine));

    return toolResult({
      found: true,
      vehicle: `${params.year} ${params.make} ${params.model}`,
      searchTerm: params.service,
      results: deduped,
      count: deduped.length,
      note: "Labor hours are industry-standard book times. " +
        "Use these values when creating estimates for accurate pricing.",
    });
  },
};

/**
 * List available service categories in OLP for a vehicle.
 * Helps the agent discover what data is available.
 */
export const listOlpCategoriesTool = {
  name: "list_vehicle_services",
  description:
    "List all available service categories and job counts for a specific vehicle from the OLP database. " +
    "Use this to discover what labor time data is available before doing a specific lookup.",
  schema: z.object({
    year: z.number().describe("Vehicle year, e.g. 2020"),
    make: z.string().describe("Vehicle make, e.g. 'Toyota'"),
    model: z.string().describe("Vehicle model, e.g. 'Camry'"),
  }),
  execute: async (
    params: { year: number; make: string; model: string },
    _ctx: unknown,
  ) => {
    const db = await getOlpDb();

    // Find matching vehicles
    let vehicles = findVehicles(db, params.make, params.model, params.year);

    if (vehicles.length === 0) {
      vehicles = findVehicles(db, params.make, params.model, params.year, true);

      if (vehicles.length === 0) {
        return toolResult({
          found: false,
          vehicle: `${params.year} ${params.make} ${params.model}`,
          message: "Vehicle not found in OLP database.",
        });
      }
    }

    const vehicleIds = vehicles.map((v) => v.id);

    // Get category breakdown
    const categories = getCategoryBreakdown(db, vehicleIds);

    return toolResult({
      found: true,
      vehicle: `${params.year} ${params.make} ${params.model}`,
      engines: vehicles.map((v) => v.engine),
      categories: categories.map((c) => ({
        category: c.category,
        jobCount: c.count,
      })),
      totalJobs: categories.reduce((sum, c) => sum + c.count, 0),
    });
  },
};

export const laborLookupTools = [lookupLaborTimeTool, listOlpCategoriesTool];
