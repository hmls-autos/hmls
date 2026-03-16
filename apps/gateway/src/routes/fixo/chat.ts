import { Hono } from "hono";
import { convertToModelMessages } from "ai";
import { runFixoAgent } from "@hmls/agent";

const chat = new Hono();

// AI SDK data stream endpoint for fixo chat
chat.post("/", async (c) => {
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
