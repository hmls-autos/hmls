// Fails if a gateway route file queries a tenant table (orders/customers/
// providers) without a shop-scope token in the same DB query statement.
//
// Design: statement-scoped scan, not a line-window scan.
//
// For chain-continuation lines (starting with `.`):
//   Walk backward to the Drizzle chain root (the line containing db/tx).
//   Walk forward until all open brackets close and the next line is not a
//   chain continuation. Check the full statement span for scope tokens.
//   Pattern B (conditions[] array spread): also resolve the variable declaration
//   for any `...ident` spread inside `.where()`/`and()` and check that for
//   scope tokens.
//
// For non-chain lines (sql templates, array elements, etc.):
//   Check the line itself, then scan backward up to 25 lines stopping at any
//   db.X query root (if that root's chain contains the reference line, check
//   the whole chain; otherwise stop). Then scan forward up to 20 lines,
//   stopping at the next db.X query root (neighbor-bleed guard).
//
// Scope tokens: whereShop, scoped(, orderAccessible, canWrite, orderInShop,
// providerInShop, shopId, customerId, shareToken, tenant-ok.
//
// Escape hatch: `// tenant-ok: <reason>` within the statement span.
// Use ONLY for queries that are genuinely cross-shop by design.
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs/walk";

const TENANT_PATTERN = /schema\.(orders|customers|providers)\b/;

/** Any of these proves a scope decision was deliberately applied. */
const SCOPE_TOKENS = [
  "whereShop",
  "scoped(",
  "orderAccessible",
  "canWrite",
  "orderInShop",
  "providerInShop",
  "shopId",
  "customerId",
  "shareToken",
  "tenant-ok",
];

/** A line is a Drizzle chain continuation if it starts with optional whitespace + `.` */
const CHAIN_CONTINUATION = /^\s*\./;

/** A line is a Drizzle query root if it contains `db` or `tx` */
const QUERY_ROOT = /\b(db|tx)\b/;

/**
 * Walk backward from startLine through chain-continuation lines (`.select`,
 * `.from`, `.where`, etc.) to find the root line that contains `db`/`tx`.
 * Handles split-line chains where `db` is on one line and `.select()` the next.
 */
function findChainRoot(lines: string[], startLine: number): number {
  const MAX_BACK = 60;
  let i = startLine;
  while (i > 0 && i > startLine - MAX_BACK && CHAIN_CONTINUATION.test(lines[i])) {
    i--;
  }
  if (QUERY_ROOT.test(lines[i])) return i;
  // Handle split: `db` alone on one line followed by `.select()` on the next
  if (i > 0 && QUERY_ROOT.test(lines[i - 1]) && !CHAIN_CONTINUATION.test(lines[i - 1])) {
    return i - 1;
  }
  return -1;
}

/**
 * Scan forward from rootLine tracking `()[]{}` nesting depth. The chain ends
 * when depth returns to 0 AND the next line is not a chain continuation.
 * Depth going negative means the chain was nested inside an outer container
 * (e.g., a Promise.all argument list) — end there too.
 */
function findChainEnd(lines: string[], rootLine: number): number {
  let depth = 0;
  for (let i = rootLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
    }
    const nextLine = lines[i + 1];
    if (depth <= 0) {
      if (depth < 0) return i;
      if (!nextLine || !CHAIN_CONTINUATION.test(nextLine)) return i;
    }
  }
  return lines.length - 1;
}

/**
 * Find the `const/let <name> = [...]` or `= ...` declaration of a variable,
 * scanning backward up to MAX_BACK lines from fromLine. Returns the span of
 * the initializer (from the `const` line to its bracket close).
 */
function findVarDeclarationSpan(
  lines: string[],
  name: string,
  fromLine: number,
): { start: number; end: number } | null {
  const MAX_BACK = 80;
  const declPattern = new RegExp(`\\b(?:const|let)\\s+${name}\\s*=`);
  for (let i = fromLine; i >= 0 && i > fromLine - MAX_BACK; i--) {
    if (declPattern.test(lines[i])) {
      let depth = 0;
      let started = false;
      for (let j = i; j < lines.length && j <= i + 40; j++) {
        for (const ch of lines[j]) {
          if (ch === "[" || ch === "(" || ch === "{") {
            depth++;
            started = true;
          } else if (ch === "]" || ch === ")" || ch === "}") {
            if (started) depth--;
          }
        }
        if (started && depth <= 0) return { start: i, end: j };
      }
      return { start: i, end: i };
    }
  }
  return null;
}

const BUILTIN_SKIP = new Set([
  "db",
  "tx",
  "schema",
  "and",
  "or",
  "eq",
  "sql",
  "desc",
  "asc",
  "not",
  "gte",
  "lte",
  "between",
  "inArray",
  "count",
  "true",
  "false",
  "null",
  "undefined",
]);

/**
 * Pattern B: check whether `...ident` spread arguments inside the statement
 * are variables whose initializer contains a scope token. Resolves each spread
 * variable's declaration by scanning backward from stmtStart.
 */
function statementPassesViaVariable(
  lines: string[],
  stmtStart: number,
  stmtEnd: number,
): boolean {
  const stmtText = lines.slice(stmtStart, stmtEnd + 1).join("\n");
  const SPREAD_PAT = /\.\.\.([a-zA-Z_]\w*)/g;
  const candidates = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = SPREAD_PAT.exec(stmtText)) !== null) {
    const ident = m[1];
    if (!BUILTIN_SKIP.has(ident)) candidates.add(ident);
  }
  for (const varName of candidates) {
    const span = findVarDeclarationSpan(lines, varName, stmtStart);
    if (!span) continue;
    const initText = lines.slice(span.start, span.end + 1).join("\n");
    if (SCOPE_TOKENS.some((t) => initText.includes(t))) return true;
  }
  return false;
}

/**
 * For non-chain-continuation lines (sql templates, array elements, etc.):
 * Check the line itself, then scan backward (stopping at a new db query that
 * does NOT contain this line), then scan forward (stopping at the next new
 * db query to prevent neighbor-bleed).
 */
function nonChainIsScoped(lines: string[], refLine: number): boolean {
  if (SCOPE_TOKENS.some((t) => lines[refLine].includes(t))) return true;

  // Backward scan: stop at any db/tx query root
  const BACK_LIMIT = 25;
  for (let i = refLine - 1; i >= 0 && i >= refLine - BACK_LIMIT; i--) {
    if (QUERY_ROOT.test(lines[i]) && !CHAIN_CONTINUATION.test(lines[i])) {
      // Found a chain root before refLine — check if refLine is inside its span
      const end = findChainEnd(lines, i);
      if (end >= refLine) {
        // This chain contains refLine — check the full chain span
        const chainText = lines.slice(i, end + 1).join("\n");
        if (SCOPE_TOKENS.some((t) => chainText.includes(t))) return true;
        if (statementPassesViaVariable(lines, i, end)) return true;
      }
      // Whether or not this chain contains refLine, stop going further back
      break;
    }
    if (SCOPE_TOKENS.some((t) => lines[i].includes(t))) return true;
  }

  // Forward scan: stop at the next db/tx query root (neighbor-bleed guard)
  const FWD_LIMIT = 20;
  for (let i = refLine + 1; i < lines.length && i <= refLine + FWD_LIMIT; i++) {
    if (QUERY_ROOT.test(lines[i]) && !CHAIN_CONTINUATION.test(lines[i])) break;
    if (SCOPE_TOKENS.some((t) => lines[i].includes(t))) return true;
  }

  return false;
}

/**
 * Returns true when the statement containing `schema.X` at `refLine` is
 * adequately scoped.
 */
function statementIsScoped(lines: string[], refLine: number): boolean {
  if (CHAIN_CONTINUATION.test(lines[refLine])) {
    // Chain continuation: find the root and full statement span
    const root = findChainRoot(lines, refLine);
    if (root === -1) return nonChainIsScoped(lines, refLine);
    const end = findChainEnd(lines, root);
    const stmtText = lines.slice(root, end + 1).join("\n");
    if (SCOPE_TOKENS.some((t) => stmtText.includes(t))) return true;
    return statementPassesViaVariable(lines, root, end);
  } else if (QUERY_ROOT.test(lines[refLine])) {
    // The reference line IS the db/tx chain root (e.g., `const x = db.select().from(schema.orders)`)
    // Treat this line as the root and check the full chain span.
    const end = findChainEnd(lines, refLine);
    const stmtText = lines.slice(refLine, end + 1).join("\n");
    if (SCOPE_TOKENS.some((t) => stmtText.includes(t))) return true;
    return statementPassesViaVariable(lines, refLine, end);
  } else {
    return nonChainIsScoped(lines, refLine);
  }
}

Deno.test(
  "every tenant-table query in a gateway route carries a shop scope",
  async () => {
    const offenders: string[] = [];
    const routesDir = new URL("./routes", import.meta.url).pathname;
    for await (const entry of walk(routesDir, { exts: [".ts"] })) {
      if (entry.name.endsWith("_test.ts")) continue;
      const lines = (await Deno.readTextFile(entry.path)).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!TENANT_PATTERN.test(lines[i])) continue;
        if (!statementIsScoped(lines, i)) {
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
