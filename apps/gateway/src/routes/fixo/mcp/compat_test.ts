// compat_test.ts — real MCP client (SDK 1.x) round-trips against our hand-rolled server.
import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { Hono } from "hono";
// deno-lint-ignore no-import-prefix -- test-only dep; not in gateway runtime imports by design.
import { Client } from "npm:@modelcontextprotocol/sdk@1.18.0/client/index.js";
// deno-lint-ignore no-import-prefix -- test-only dep; not in gateway runtime imports by design.
import { StreamableHTTPClientTransport } from "npm:@modelcontextprotocol/sdk@1.18.0/client/streamableHttp.js";
import { handleMcpMessage, type McpTool } from "./jsonrpc.ts";

const stub: McpTool[] = [{
  name: "ping",
  description: "Echo a message.",
  inputSchema: z.object({ msg: z.string() }),
  execute: (args) =>
    Promise.resolve({ content: [{ type: "text", text: `pong:${(args as { msg: string }).msg}` }] }),
}];

Deno.test("real MCP client: initialize + tools/list + tools/call round-trip", async () => {
  const app = new Hono();
  app.post("/mcp", async (c) => {
    const msg = await c.req.json();
    // deno-lint-ignore no-explicit-any
    const r = await handleMcpMessage(msg as any, stub, { name: "fixo", version: "1.0.0" });
    return r === null ? c.body(null, 202) : c.json(r);
  });
  const server = Deno.serve({ port: 0, onListen: () => {} }, app.fetch);
  const port = (server.addr as Deno.NetAddr).port;

  const client = new Client({ name: "compat-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));
  try {
    await client.connect(transport); // performs initialize
    const list = await client.listTools();
    assert(list.tools.some((t) => t.name === "ping"), "ping should be listed");
    const res = await client.callTool({ name: "ping", arguments: { msg: "hi" } });
    // deno-lint-ignore no-explicit-any
    assertEquals((res.content as any)[0].text, "pong:hi");
  } finally {
    await client.close().catch(() => {});
    await server.shutdown();
  }
});
