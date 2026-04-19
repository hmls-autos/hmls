import { Hono } from "hono";
import { convertToModelMessages } from "ai";
import { type AgentConfig, runStaffAgent } from "@hmls/agent";
import { Errors } from "@hmls/shared/errors";
import { type AdminEnv, requireAdmin } from "../middleware/admin.ts";
import { getGatewayLogger } from "../logger.ts";

const logger = getGatewayLogger("staff-chat");

let _config: AgentConfig;

export function initStaffChat(config: AgentConfig) {
  _config = config;
}

const staffChat = new Hono<AdminEnv>();

// Staff chat endpoint — requires admin JWT
staffChat.post("/", requireAdmin, async (c) => {
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

  const authUser = c.get("authUser");
  const startTime = Date.now();
  logger.info("Request received", {
    userId: authUser.id,
    messageCount: messages.length,
  });

  try {
    const modelMessages = await convertToModelMessages(messages);

    const result = runStaffAgent({
      messages: modelMessages,
      config: _config,
    });

    const response = result.toUIMessageStreamResponse();
    const duration = Date.now() - startTime;
    logger.info("Request finished", {
      userId: authUser.id,
      messageCount: messages.length,
      duration,
    });
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Agent failed", {
      userId: authUser.id,
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

export { staffChat };
