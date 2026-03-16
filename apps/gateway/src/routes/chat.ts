import { Hono } from "hono";
import { convertToModelMessages } from "ai";
import { eq } from "drizzle-orm";
import { type AgentConfig, runHmlsAgent, type UserContext } from "@hmls/agent";
import { db, schema } from "@hmls/agent/db";
import { Errors } from "@hmls/shared/errors";
import { optionalAuth, type OptionalAuthEnv } from "../middleware/auth.ts";

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

const chat = new Hono<OptionalAuthEnv>();

// AI SDK data stream endpoint
chat.post("/", optionalAuth, async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "BAD_REQUEST", message: "Invalid JSON body" } },
      400,
    );
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    throw Errors.validation("Invalid request", "messages array is required");
  }

  // Resolve authenticated user -> customer record via JWT
  let userContext: UserContext | undefined;
  const authUser = c.get("authUser");
  if (authUser) {
    userContext = await resolveCustomer({ email: authUser.email });
  }

  console.log(
    `[agent] messages=${messages.length}, user=${userContext?.id ?? "anonymous"}`,
  );

  try {
    const modelMessages = await convertToModelMessages(messages);

    const result = runHmlsAgent({
      messages: modelMessages,
      config: _config,
      userContext,
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error(`[agent] Agent error:`, error);
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
