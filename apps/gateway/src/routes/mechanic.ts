import { Hono } from "hono";
import { and, asc, between, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@hmls/agent/db";
import { type MechanicEnv, requireMechanic } from "../middleware/mechanic.ts";

const mechanic = new Hono<MechanicEnv>();

mechanic.use("*", requireMechanic);

// ---------------------------------------------------------------------------
// GET /me — current mechanic's provider record
// ---------------------------------------------------------------------------

mechanic.get("/me", async (c) => {
  const providerId = c.get("providerId");
  const [provider] = await db
    .select()
    .from(schema.providers)
    .where(eq(schema.providers.id, providerId))
    .limit(1);

  if (!provider) {
    return c.json({ error: { code: "NOT_FOUND", message: "Provider not found" } }, 404);
  }
  return c.json(provider);
});

// ---------------------------------------------------------------------------
// Weekly availability
// ---------------------------------------------------------------------------

mechanic.get("/availability", async (c) => {
  const providerId = c.get("providerId");
  const rows = await db
    .select()
    .from(schema.providerAvailability)
    .where(eq(schema.providerAvailability.providerId, providerId))
    .orderBy(asc(schema.providerAvailability.dayOfWeek));
  return c.json(rows);
});

// Replace the full weekly schedule atomically
mechanic.put("/availability", async (c) => {
  const providerId = c.get("providerId");
  const body = await c.req.json<{
    availability: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
  }>().catch(() => null);

  if (!body?.availability || !Array.isArray(body.availability)) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "availability array required" } },
      400,
    );
  }

  // Validate
  for (const row of body.availability) {
    if (
      !Number.isInteger(row.dayOfWeek) ||
      row.dayOfWeek < 0 ||
      row.dayOfWeek > 6 ||
      !/^\d{2}:\d{2}(:\d{2})?$/.test(row.startTime) ||
      !/^\d{2}:\d{2}(:\d{2})?$/.test(row.endTime)
    ) {
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "Invalid row: dayOfWeek 0-6, HH:MM[:SS] times required",
          },
        },
        400,
      );
    }
    if (row.endTime <= row.startTime) {
      return c.json(
        { error: { code: "BAD_REQUEST", message: "endTime must be after startTime" } },
        400,
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.providerAvailability)
      .where(eq(schema.providerAvailability.providerId, providerId));
    if (body.availability.length > 0) {
      await tx.insert(schema.providerAvailability).values(
        body.availability.map((a) => ({ providerId, ...a })),
      );
    }
  });

  const rows = await db
    .select()
    .from(schema.providerAvailability)
    .where(eq(schema.providerAvailability.providerId, providerId))
    .orderBy(asc(schema.providerAvailability.dayOfWeek));
  return c.json(rows);
});

// ---------------------------------------------------------------------------
// Date-specific overrides (time off, extra hours)
// ---------------------------------------------------------------------------

mechanic.get("/overrides", async (c) => {
  const providerId = c.get("providerId");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions = [eq(schema.providerScheduleOverrides.providerId, providerId)];
  if (from) conditions.push(gte(schema.providerScheduleOverrides.overrideDate, from));
  if (to) conditions.push(lte(schema.providerScheduleOverrides.overrideDate, to));

  const rows = await db
    .select()
    .from(schema.providerScheduleOverrides)
    .where(and(...conditions))
    .orderBy(asc(schema.providerScheduleOverrides.overrideDate));
  return c.json(rows);
});

mechanic.post("/overrides", async (c) => {
  const providerId = c.get("providerId");
  const body = await c.req.json<{
    overrideDate: string;
    isAvailable: boolean;
    startTime?: string;
    endTime?: string;
    reason?: string;
  }>().catch(() => null);

  if (!body?.overrideDate || typeof body.isAvailable !== "boolean") {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "overrideDate (YYYY-MM-DD) and isAvailable required",
        },
      },
      400,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.overrideDate)) {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "overrideDate must be YYYY-MM-DD" } },
      400,
    );
  }
  if (body.isAvailable && (!body.startTime || !body.endTime)) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "startTime and endTime required when isAvailable is true",
        },
      },
      400,
    );
  }

  // Upsert: one override per (provider, date). Delete any existing first.
  await db
    .delete(schema.providerScheduleOverrides)
    .where(
      and(
        eq(schema.providerScheduleOverrides.providerId, providerId),
        eq(schema.providerScheduleOverrides.overrideDate, body.overrideDate),
      ),
    );

  const [created] = await db
    .insert(schema.providerScheduleOverrides)
    .values({
      providerId,
      overrideDate: body.overrideDate,
      isAvailable: body.isAvailable,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      reason: body.reason ?? null,
    })
    .returning();
  return c.json(created, 201);
});

mechanic.delete("/overrides/:id", async (c) => {
  const providerId = c.get("providerId");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid override ID" } }, 400);
  }

  const result = await db
    .delete(schema.providerScheduleOverrides)
    .where(
      and(
        eq(schema.providerScheduleOverrides.id, id),
        eq(schema.providerScheduleOverrides.providerId, providerId),
      ),
    )
    .returning({ id: schema.providerScheduleOverrides.id });

  if (result.length === 0) {
    return c.json({ error: { code: "NOT_FOUND", message: "Override not found" } }, 404);
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// My orders (mechanic's assigned work)
// ---------------------------------------------------------------------------

mechanic.get("/orders", async (c) => {
  const providerId = c.get("providerId");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions = [eq(schema.orders.providerId, providerId)];
  if (from && to) {
    conditions.push(between(schema.orders.scheduledAt, new Date(from), new Date(to)));
  } else if (from) {
    conditions.push(gte(schema.orders.scheduledAt, new Date(from)));
  } else if (to) {
    conditions.push(lte(schema.orders.scheduledAt, new Date(to)));
  }

  const rows = await db
    .select()
    .from(schema.orders)
    .where(and(...conditions))
    .orderBy(asc(schema.orders.scheduledAt));
  return c.json(rows);
});

export { mechanic };
