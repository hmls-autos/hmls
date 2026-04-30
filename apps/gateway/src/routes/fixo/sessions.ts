import { Hono } from "hono";
import { db, schema } from "@hmls/agent/db";
import { desc, eq, or } from "drizzle-orm";
import type { AuthContext } from "../../middleware/fixo/auth.ts";

type Variables = { auth: AuthContext };

const sessions = new Hono<{ Variables: Variables }>();

// POST /sessions - Start new session
sessions.post("/", async (c) => {
  const auth = c.get("auth");

  const [session] = await db
    .insert(schema.fixoSessions)
    .values({
      userId: auth.userId,
      customerId: auth.customerId ?? null,
    })
    .returning();

  return c.json({
    sessionId: session.id,
    status: session.status,
    message: "Fixo session started. Send inputs to analyze.",
  });
});

// GET /sessions - List sessions
sessions.get("/", async (c) => {
  const auth = c.get("auth");

  // Match by userId (SaaS) or customerId (legacy)
  const conditions = [eq(schema.fixoSessions.userId, auth.userId)];
  if (auth.customerId) {
    conditions.push(eq(schema.fixoSessions.customerId, auth.customerId));
  }

  // Explicitly omit `messages` — the list view only needs the summary fields,
  // and the persisted transcript can be large enough that streaming the whole
  // history page payload would slow noticeably for heavy users.
  const sessions_ = await db
    .select({
      id: schema.fixoSessions.id,
      customerId: schema.fixoSessions.customerId,
      userId: schema.fixoSessions.userId,
      vehicleId: schema.fixoSessions.vehicleId,
      status: schema.fixoSessions.status,
      creditsCharged: schema.fixoSessions.creditsCharged,
      createdAt: schema.fixoSessions.createdAt,
      completedAt: schema.fixoSessions.completedAt,
      result: schema.fixoSessions.result,
    })
    .from(schema.fixoSessions)
    .where(or(...conditions))
    .orderBy(desc(schema.fixoSessions.createdAt));

  return c.json({ sessions: sessions_ });
});

// GET /sessions/:id - Get session details
sessions.get("/:id", async (c) => {
  const auth = c.get("auth");
  const sessionId = parseInt(c.req.param("id"));

  const [session] = await db
    .select()
    .from(schema.fixoSessions)
    .where(eq(schema.fixoSessions.id, sessionId))
    .limit(1);

  if (
    !session ||
    (session.userId !== auth.userId &&
      session.customerId !== auth.customerId)
  ) {
    return c.json({ error: "Session not found" }, 404);
  }

  const media = await db
    .select()
    .from(schema.fixoMedia)
    .where(eq(schema.fixoMedia.sessionId, sessionId));

  const codes = await db
    .select()
    .from(schema.obdCodes)
    .where(eq(schema.obdCodes.sessionId, sessionId));

  return c.json({ session, media, codes });
});

export { sessions };
