import { Hono } from "hono";
import { convertToModelMessages } from "ai";
import { eq } from "drizzle-orm";
import { type AgentConfig, runHmlsAgent, type UserContext } from "@hmls/agent";
import { db, schema } from "@hmls/agent/db";
import { Errors } from "@hmls/shared/errors";
import { type AuthUserEnv, requireAuthUser } from "../middleware/auth.ts";
import { getGatewayLogger } from "../logger.ts";

const logger = getGatewayLogger("chat");

let _config: AgentConfig;

export function initChat(config: AgentConfig) {
  _config = config;
}

/** Look up customer by email, or create one if not found. */
async function resolveCustomer(
  userInfo: { email: string; name?: string; phone?: string },
): Promise<UserContext | undefined> {
  if (!userInfo.email) return undefined;

  // Try to find existing customer by email
  const [existing] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.email, userInfo.email))
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      name: existing.name ?? userInfo.name ?? "",
      email: existing.email ?? userInfo.email,
      phone: existing.phone ?? userInfo.phone ?? "",
    };
  }

  // Create new customer
  const [created] = await db
    .insert(schema.customers)
    .values({
      name: userInfo.name || null,
      email: userInfo.email,
      phone: userInfo.phone || null,
    })
    .returning();

  return {
    id: created.id,
    name: created.name ?? "",
    email: created.email ?? userInfo.email,
    phone: created.phone ?? "",
  };
}

const chat = new Hono<AuthUserEnv>();

// AI SDK data stream endpoint
chat.post("/", requireAuthUser, async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch (e) {
    const raw = await c.req.text().catch(() => "<unreadable>");
    logger.error("JSON parse failed", { error: String(e), rawBody: raw.slice(0, 500) });
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      400,
    );
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    logger.error("Validation failed", {
      messagesType: typeof messages,
      bodyKeys: Object.keys(body),
    });
    throw Errors.validation("Invalid request", "messages array is required");
  }

  // Resolve authenticated user -> customer record (upsert on first contact).
  const authUser = c.get("authUser");
  const userContext = await resolveCustomer({ email: authUser.email });

  const startTime = Date.now();
  const userId = userContext?.id ?? authUser.email;
  const messageCount = messages.length;
  logger.info("Request received", { userId, messageCount });

  try {
    const modelMessages = await convertToModelMessages(messages);

    const result = runHmlsAgent({
      messages: modelMessages,
      config: _config,
      userContext,
    });

    const response = result.toUIMessageStreamResponse();
    const duration = Date.now() - startTime;
    logger.info("Request finished", { userId, messageCount, duration });
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Agent failed", {
      userId,
      messageCount,
      duration,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json(
      {
        error: {
          code: "AGENT_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      500,
    );
  }
});

export { chat };
