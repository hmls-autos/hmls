import { z } from "zod";
import { and, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "../../db/client.ts";
import { toolResult } from "@hmls/shared/tool-result";

/**
 * Lookup labor times from OLP (Open Labor Project) reference data.
 * 2.4M+ entries across 4,400+ vehicles — real industry labor guides.
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
    // 1. Find matching vehicles (make + model + year in range)
    const vehicles = await db
      .select({
        id: schema.olpVehicles.id,
        make: schema.olpVehicles.make,
        model: schema.olpVehicles.model,
        yearRange: schema.olpVehicles.yearRange,
        engine: schema.olpVehicles.engine,
        fuelType: schema.olpVehicles.fuelType,
      })
      .from(schema.olpVehicles)
      .where(
        and(
          ilike(schema.olpVehicles.make, params.make),
          ilike(schema.olpVehicles.model, params.model),
          lte(schema.olpVehicles.yearStart, params.year),
          gte(schema.olpVehicles.yearEnd, params.year),
        ),
      );

    if (vehicles.length === 0) {
      // Try fuzzy make + model match
      const fuzzyVehicles = await db
        .select({
          id: schema.olpVehicles.id,
          make: schema.olpVehicles.make,
          model: schema.olpVehicles.model,
          yearRange: schema.olpVehicles.yearRange,
          engine: schema.olpVehicles.engine,
          fuelType: schema.olpVehicles.fuelType,
        })
        .from(schema.olpVehicles)
        .where(
          and(
            ilike(schema.olpVehicles.make, `%${params.make}%`),
            ilike(schema.olpVehicles.model, `%${params.model}%`),
            lte(schema.olpVehicles.yearStart, params.year),
            gte(schema.olpVehicles.yearEnd, params.year),
          ),
        );

      if (fuzzyVehicles.length === 0) {
        return toolResult({
          found: false,
          vehicle: `${params.year} ${params.make} ${params.model}`,
          service: params.service,
          message:
            "Vehicle not found in OLP database. Estimate labor hours based on industry knowledge.",
        });
      }

      vehicles.push(...fuzzyVehicles);
    }

    const vehicleIds = vehicles.map((v) => v.id);

    // 2. Search labor times for matching service (fuzzy: match each word independently)
    const serviceWords = params.service
      .split(/\s+/)
      .filter((w) => w.length > 1);
    const conditions = [
      inArray(schema.olpLaborTimes.vehicleId, vehicleIds),
      ...serviceWords.map((word) => ilike(schema.olpLaborTimes.name, `%${word}%`)),
    ];

    if (params.category) {
      conditions.push(
        ilike(schema.olpLaborTimes.category, params.category),
      );
    }

    const laborTimes = await db
      .select({
        name: schema.olpLaborTimes.name,
        category: schema.olpLaborTimes.category,
        laborHours: schema.olpLaborTimes.laborHours,
        vehicleId: schema.olpLaborTimes.vehicleId,
      })
      .from(schema.olpLaborTimes)
      .where(and(...conditions))
      .limit(30);

    if (laborTimes.length === 0 && serviceWords.length > 1) {
      // Fallback 1: try matching ANY word (OR instead of AND) to surface partial matches
      const orConditions = [
        inArray(schema.olpLaborTimes.vehicleId, vehicleIds),
        sql`(${
          sql.join(
            serviceWords.map(
              (word) => sql`${schema.olpLaborTimes.name} ilike ${"%" + word + "%"}`,
            ),
            sql` OR `,
          )
        })`,
      ];
      if (params.category) {
        orConditions.push(
          ilike(schema.olpLaborTimes.category, params.category),
        );
      }
      const fallbackTimes = await db
        .select({
          name: schema.olpLaborTimes.name,
          category: schema.olpLaborTimes.category,
          laborHours: schema.olpLaborTimes.laborHours,
          vehicleId: schema.olpLaborTimes.vehicleId,
        })
        .from(schema.olpLaborTimes)
        .where(and(...orConditions))
        .limit(30);

      laborTimes.push(...fallbackTimes);
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
      const vehicle = vehicleMap.get(lt.vehicleId);
      return {
        service: lt.name,
        category: lt.category,
        laborHours: Number(lt.laborHours),
        engine: vehicle?.engine ?? "unknown",
        fuelType: vehicle?.fuelType ?? null,
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
    // Find matching vehicles
    const vehicles = await db
      .select({ id: schema.olpVehicles.id, engine: schema.olpVehicles.engine })
      .from(schema.olpVehicles)
      .where(
        and(
          ilike(schema.olpVehicles.make, params.make),
          ilike(schema.olpVehicles.model, params.model),
          lte(schema.olpVehicles.yearStart, params.year),
          gte(schema.olpVehicles.yearEnd, params.year),
        ),
      );

    if (vehicles.length === 0) {
      // Try fuzzy model match
      const fuzzyVehicles = await db
        .select({ id: schema.olpVehicles.id, engine: schema.olpVehicles.engine })
        .from(schema.olpVehicles)
        .where(
          and(
            ilike(schema.olpVehicles.make, `%${params.make}%`),
            ilike(schema.olpVehicles.model, `%${params.model}%`),
            lte(schema.olpVehicles.yearStart, params.year),
            gte(schema.olpVehicles.yearEnd, params.year),
          ),
        );

      if (fuzzyVehicles.length === 0) {
        return toolResult({
          found: false,
          vehicle: `${params.year} ${params.make} ${params.model}`,
          message: "Vehicle not found in OLP database.",
        });
      }

      vehicles.push(...fuzzyVehicles);
    }

    const vehicleIds = vehicles.map((v) => v.id);

    // Get category breakdown
    const categories = await db
      .select({
        category: schema.olpLaborTimes.category,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.olpLaborTimes)
      .where(inArray(schema.olpLaborTimes.vehicleId, vehicleIds))
      .groupBy(schema.olpLaborTimes.category)
      .orderBy(schema.olpLaborTimes.category);

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
