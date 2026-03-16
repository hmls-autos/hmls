import { Hono } from "hono";
import { convertToModelMessages } from "ai";
import { runFixoAgent } from "@hmls/agent";
import { checkFreeTierLimit } from "../../middleware/fixo/tier.ts";
import type { AuthContext } from "../../middleware/fixo/auth.ts";

type Variables = { auth: AuthContext };

const chat = new Hono<{ Variables: Variables }>();

// AI SDK data stream endpoint for fixo chat
chat.post("/", async (c) => {
  const auth = c.get("auth");

  // Validate that the user has an active subscription/tier before running the agent
  const tierBlock = await checkFreeTierLimit(auth, "text");
  if (tierBlock) return tierBlock;

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: "Invalid JSON body" },
      400,
    );
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    return c.json(
      { error: "Invalid request: messages array is required" },
      400,
    );
  }

  console.log(`[fixo-agent] messages=${messages.length}`);

  try {
    const modelMessages = await convertToModelMessages(messages);

    const result = runFixoAgent({ messages: modelMessages });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error(`[fixo-agent] Agent error:`, error);
    return c.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

export { chat };
