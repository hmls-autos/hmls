import { Hono } from "hono";
import { db, schema } from "@hmls/agent/db";
import { desc, eq, or } from "drizzle-orm";
import type { AuthContext } from "../../middleware/diagnostic/auth.ts";

type Variables = { auth: AuthContext };

const sessions = new Hono<{ Variables: Variables }>();

// POST /diagnostics - Start new session
sessions.post("/", async (c) => {
  const auth = c.get("auth");

  const [session] = await db
    .insert(schema.diagnosticSessions)
    .values({
      userId: auth.userId,
      customerId: auth.customerId ?? null,
    })
    .returning();

  return c.json({
    sessionId: session.id,
    status: session.status,
    message: "Diagnostic session started. Send inputs to analyze.",
  });
});

// GET /diagnostics - List sessions
sessions.get("/", async (c) => {
  const auth = c.get("auth");

  // Match by userId (SaaS) or customerId (legacy)
  const conditions = [eq(schema.diagnosticSessions.userId, auth.userId)];
  if (auth.customerId) {
    conditions.push(eq(schema.diagnosticSessions.customerId, auth.customerId));
  }

  const sessions_ = await db
    .select()
    .from(schema.diagnosticSessions)
    .where(or(...conditions))
    .orderBy(desc(schema.diagnosticSessions.createdAt));

  return c.json({ sessions: sessions_ });
});

// GET /diagnostics/:id - Get session details
sessions.get("/:id", async (c) => {
  const auth = c.get("auth");
  const sessionId = parseInt(c.req.param("id"));

  const [session] = await db
    .select()
    .from(schema.diagnosticSessions)
    .where(eq(schema.diagnosticSessions.id, sessionId))
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
    .from(schema.diagnosticMedia)
    .where(eq(schema.diagnosticMedia.sessionId, sessionId));

  const codes = await db
    .select()
    .from(schema.obdCodes)
    .where(eq(schema.obdCodes.sessionId, sessionId));

  return c.json({ session, media, codes });
});

export { sessions };
