// Fails if a gateway route file queries a tenant table (orders/customers/
// providers) without a shop-scope token near the query. Stronger than the old
// per-file substring check (which passed on a mere comment mention of
// "shopId"): it inspects EACH schema.<tenant-table> reference and requires a
// scope token within a small line window. RLS (separate spec) is the real
// isolation backstop; this is the cheap CI net until then.
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs/walk";

const TENANT_LINE = /schema\.(orders|customers|providers)\b/;
// Any of these near the query proves a scope decision was deliberately made.
const SCOPE_TOKENS = [
  "whereShop",
  "scoped(",
  "orderAccessible",
  "canWrite",
  "orderInShop",
  "providerInShop",
  "shopId",
  "customerId", // customer-owned-row scoping (portal / estimates authed path)
  "shareToken", // capability-token auth for public links (estimates / pdf)
  "tenant-ok", // explicit escape hatch: `// tenant-ok: <reason>`
];
const WINDOW = 12; // lines after a tenant-table line to scan for a scope token

Deno.test(
  "every tenant-table query in a gateway route carries a shop scope",
  async () => {
    const offenders: string[] = [];
    const routesDir = new URL("./routes", import.meta.url).pathname;
    for await (const entry of walk(routesDir, { exts: [".ts"] })) {
      if (entry.name.endsWith("_test.ts")) continue;
      const lines = (await Deno.readTextFile(entry.path)).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!TENANT_LINE.test(lines[i])) continue;
        const windowText = lines.slice(i, i + WINDOW + 1).join("\n");
        if (!SCOPE_TOKENS.some((t) => windowText.includes(t))) {
          offenders.push(`${entry.name}:${i + 1}`);
        }
      }
    }
    assertEquals(
      offenders,
      [],
      `Unscoped tenant-table queries (add a scope predicate or a "// tenant-ok: <reason>" comment): ${
        offenders.join(", ")
      }`,
    );
  },
);
