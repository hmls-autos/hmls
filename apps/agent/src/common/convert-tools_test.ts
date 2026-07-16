import { assertEquals } from "@std/assert";
import { convertTools, type LegacyTool } from "./convert-tools.ts";

// Regression: AI SDK v7 validates tool outputs as strict JSON when building the
// next step's prompt — a Date in a tool result (create_order's expiresAt,
// get_order's scheduledAt) killed the stream as "An error occurred.".
// convertTools must return only JSON-safe values.
Deno.test("convertTools: tool results are JSON-safe (Date -> ISO string)", async () => {
  const tool: LegacyTool = {
    name: "fake_tool",
    description: "",
    schema: undefined,
    execute: () =>
      Promise.resolve({
        expiresAt: new Date("2026-07-30T00:00:00Z"),
        nested: [{ scheduledAt: new Date("2026-08-01T12:00:00Z") }],
        n: 1,
      }),
  };
  // No ctx → unscoped path (no DB involved).
  const converted = convertTools([tool]);
  const result = await converted.fake_tool.execute({}) as {
    expiresAt: unknown;
    nested: [{ scheduledAt: unknown }];
    n: number;
  };
  assertEquals(result.expiresAt, "2026-07-30T00:00:00.000Z");
  assertEquals(result.nested[0].scheduledAt, "2026-08-01T12:00:00.000Z");
  assertEquals(result.n, 1);
});
