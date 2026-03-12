import { Hono } from "hono";
import { db, schema } from "@hmls/agent/db";
import { and, eq } from "drizzle-orm";
import type { AuthContext } from "../../middleware/diagnostic/auth.ts";

type Variables = { auth: AuthContext };

const vehicleRoutes = new Hono<{ Variables: Variables }>();

// GET /vehicles - List user's vehicles
vehicleRoutes.get("/", async (c) => {
  const auth = c.get("auth");

  const userVehicles = await db
    .select()
    .from(schema.vehicles)
    .where(eq(schema.vehicles.userId, auth.userId));

  return c.json({ vehicles: userVehicles });
});

// POST /vehicles - Add a vehicle
vehicleRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json<{
    year?: number;
    make: string;
    model: string;
    vin?: string;
    nickname?: string;
  }>();

  if (!body.make || !body.model) {
    return c.json({ error: "Make and model are required" }, 400);
  }

  // Free tier: limit to 1 vehicle
  if (auth.tier === "free") {
    const existing = await db
      .select()
      .from(schema.vehicles)
      .where(eq(schema.vehicles.userId, auth.userId));
    if (existing.length >= 1) {
      return c.json(
        {
          error: "upgrade_required",
          message: "Free plan is limited to 1 vehicle. Upgrade to Plus for unlimited vehicles.",
        },
        403,
      );
    }
  }

  const [vehicle] = await db
    .insert(schema.vehicles)
    .values({
      userId: auth.userId,
      year: body.year ?? null,
      make: body.make,
      model: body.model,
      vin: body.vin ?? null,
      nickname: body.nickname ?? null,
    })
    .returning();

  return c.json({ vehicle }, 201);
});

// DELETE /vehicles/:id - Remove a vehicle
vehicleRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const vehicleId = c.req.param("id");

  const [vehicle] = await db
    .select()
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.userId, auth.userId)))
    .limit(1);

  if (!vehicle) {
    return c.json({ error: "Vehicle not found" }, 404);
  }

  await db
    .delete(schema.vehicles)
    .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.userId, auth.userId)));

  return c.json({ success: true });
});

export { vehicleRoutes };
