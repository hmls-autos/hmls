import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eachValueFrom } from "rxjs-for-await";
import { concatMap, from, pipe } from "rxjs";
import { createDiagnosticAgent } from "@hmls/agent";
import {
  convertAguiMessagesToZypher,
  createAguiEventStream,
  parseRunAgentInput,
} from "@zypher/agui";

/**
 * RxJS operator that ensures all TOOL_CALL_START events have matching
 * TOOL_CALL_END events before RUN_FINISHED is emitted.
 */
function sanitizeToolCallEvents() {
  const openToolCalls = new Set<string>();

  // deno-lint-ignore no-explicit-any
  return pipe(concatMap((event: any) => {
    if (event.type === "TOOL_CALL_START") {
      openToolCalls.add(event.toolCallId);
    } else if (event.type === "TOOL_CALL_END") {
      openToolCalls.delete(event.toolCallId);
    }

    if (event.type === "RUN_FINISHED" && openToolCalls.size > 0) {
      // deno-lint-ignore no-explicit-any
      const closingEvents: any[] = [];
      for (const toolCallId of openToolCalls) {
        closingEvents.push({
          type: "TOOL_CALL_END",
          toolCallId,
          timestamp: Date.now(),
        });
      }
      openToolCalls.clear();
      return from([...closingEvents, event]);
    }

    return from([event]);
  }));
}

const chat = new Hono();

// AG-UI streaming endpoint for real-time chat
chat.post("/", async (c) => {
  const body = await c.req.json();

  let input;
  try {
    input = parseRunAgentInput(body);
  } catch (parseError) {
    return c.json(
      { error: "Invalid AG-UI input", details: String(parseError) },
      400,
    );
  }

  const { threadId, runId, messages } = input;
  console.log(
    `[diagnostic-agent] threadId=${threadId}, messages=${messages.length}`,
  );

  // Convert previous messages to Zypher format for conversation context.
  // Creates a fresh agent per request — stateless, no in-memory cache dependency.
  const historyMessages = messages.slice(0, -1);
  const initialMessages = historyMessages.length > 0
    ? convertAguiMessagesToZypher(historyMessages)
    : undefined;

  const agentInstance = await createDiagnosticAgent({ initialMessages });
  const aguiStream = createAguiEventStream({
    agent: agentInstance,
    messages,
    threadId,
    runId,
  }).pipe(sanitizeToolCallEvents());

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of eachValueFrom(aguiStream)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (error) {
      console.error(`[diagnostic-agent] Stream error:`, error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "RUN_ERROR",
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

export { chat };
