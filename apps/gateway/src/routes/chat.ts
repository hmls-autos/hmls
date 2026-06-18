import { Hono } from "hono";
import { convertToModelMessages } from "ai";
import { eq } from "drizzle-orm";
import { type AgentConfig, runHmlsAgent, type UserContext } from "@hmls/agent";
import { db, schema } from "@hmls/agent/db";
import { routeOrderToShop } from "@hmls/agent/common/shop-routing";
import { Errors } from "@hmls/shared/errors";
import { getLogger } from "@logtape/logtape";
import { type AuthUserEnv, requireAuthUser } from "../middleware/auth.ts";

const logger = getLogger(["hmls", "gateway", "chat"]);

let _config: AgentConfig;

export function initChat(config: AgentConfig) {
  _config = config;
}

/** Look up customer by email, or create one if not found.
 *  Returns the customer context AND their shopId (resolved from the DB row,
 *  or stamped at creation using the primary shop). */
async function resolveCustomer(
  userInfo: { email: string; name?: string; phone?: string },
): Promise<{ ctx: UserContext; shopId: string } | undefined> {
  if (!userInfo.email) return undefined;

  // Try to find existing customer by email
  const [existing] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.email, userInfo.email))
    .limit(1);

  if (existing) {
    // Use the customer's assigned shopId, or fall back to primary shop if unset.
    let shopId = existing.shopId ?? null;
    if (!shopId) {
      const { shopId: primary } = await routeOrderToShop(null);
      shopId = primary;
    }
    return {
      ctx: {
        id: existing.id,
        name: existing.name ?? userInfo.name ?? "",
        email: existing.email ?? userInfo.email,
        phone: existing.phone ?? userInfo.phone ?? "",
      },
      shopId,
    };
  }

  // Resolve primary shop for new customers (address unknown at first contact).
  const { shopId } = await routeOrderToShop(null);

  // Create new customer stamped with the primary shop.
  const [created] = await db
    .insert(schema.customers)
    .values({
      name: userInfo.name || null,
      email: userInfo.email,
      phone: userInfo.phone || null,
      shopId,
    })
    .returning();

  return {
    ctx: {
      id: created.id,
      name: created.name ?? "",
      email: created.email ?? userInfo.email,
      phone: created.phone ?? "",
    },
    shopId: created.shopId ?? shopId,
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

  // Admins have their own chat (/api/admin/chat) and must not mix message
  // history into the customer-facing HMLS agent. Block here as defense in
  // depth; the web UI also redirects admins to /admin/chat.
  const authUser = c.get("authUser");
  if (authUser.role === "admin") {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Admins must use the admin chat at /admin/chat",
        },
      },
      403,
    );
  }

  // Resolve authenticated user -> customer record (upsert on first contact).
  const resolved = await resolveCustomer({ email: authUser.email });
  const userContext = resolved?.ctx;
  const shopId = resolved?.shopId;

  const startTime = Date.now();
  const userId = userContext?.id ?? authUser.email;
  const messageCount = messages.length;
  logger.info("Request received", { userId, shopId, messageCount });

  try {
    const modelMessages = await convertToModelMessages(messages);

    const result = await runHmlsAgent({
      messages: modelMessages,
      config: _config,
      userContext,
      shopId,
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
