# Fixo Self-Serve API Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in fixo.ink user self-serves a Fixo API key and points their MCP client at
`/v1/mcp` — no manual key minting — behind the external-key safety gate (input bounds + per-key rate
limit + record_outcome ownership).

**Architecture:** Session-authed key-management endpoints on the gateway (mint/list/revoke, owned by
the Supabase `userId`); a hand-written migration adds `fixo_api_keys.user_id` +
`fixo_predictions.api_key_id` + a `fixo_rate_limit` counter table; the api-key middleware enforces a
DB fixed-window rate limit after verify; the calling key's id is threaded from the middleware → MCP
route → tool `execute` so `diagnose` stamps the prediction and `record_outcome` checks ownership; a
fixo-web "API keys" page under Settings drives it.

**Tech Stack:** Deno + Hono (gateway), Deno (agent), Drizzle/Postgres, zod v4; Bun + Next.js App
Router + Supabase + shadcn/ui (fixo-web).

## Global Constraints

- **External surface = MCP only.** `/v1/diagnose` stays dormant/unadvertised (NOT removed). The UI
  getting-started shows ONLY the MCP endpoint (`https://api.fixo.ink/v1/mcp`).
- **Free, rate-limited tier.** No billing/credits. Rate-limit numbers in ONE config constant:
  `RATE_LIMITS = { perMin: 20, perDay: 200 }`.
- **Migrations are HAND-WRITTEN** (`apps/agent/migrations/NNNN_*.sql`, idempotent).
  `db:push`/`db:generate` UNSAFE. Latest on main is `0032`; this adds `0033`. AUTHOR it, do NOT
  apply (operator applies post-deploy via psql -f).
- Keys stored SHA-256 hashed; plaintext shown ONCE. `user_id`/`api_key_id` are NULLABLE
  (manually-minted keys + their predictions stay NULL).
- Deno: `deno check`/`deno lint`/`deno fmt`. Web: `bun run lint`/`typecheck`/`test`/`build`. zod v4.
  Conventional commits ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Keep pure logic (rate-limit bucket math, the JSON-RPC ctx threading shape) in test-safe modules
  where it avoids importing the heavy agent graph.

---

## File structure

- **Create** `apps/agent/migrations/0033_api_key_ownership.sql` — `fixo_api_keys.user_id`,
  `fixo_predictions.api_key_id`, `fixo_rate_limit` table.
- **Modify** `packages/shared/src/db/schema.ts` — add the two columns + the `fixoRateLimit` table.
- **Modify** `apps/agent/src/fixo/lib/api-keys.ts` — `createApiKeyForUser`, `listApiKeysForUser`,
  `revokeApiKeyForUser`.
- **Create** `apps/agent/src/fixo/lib/rate-limit.ts` — `bucketKey` (pure) + `checkRateLimit`.
- **Modify** `apps/agent/src/mod.ts` — export the new lib functions.
- **Create** `apps/gateway/src/routes/fixo/keys.ts` — the session-authed `keys` router.
- **Modify** `apps/gateway/src/fixo-app.ts` — mount `keys` under `requireAuth`; add rate-limit to
  `requireApiKey`.
- **Modify** `apps/gateway/src/routes/fixo/mcp/jsonrpc.ts` — thread a `ctx` into
  `handleMcpMessage` + `McpTool.execute`.
- **Modify** `apps/gateway/src/routes/fixo/mcp/route.ts` — pass `{ apiKeyId: c.get("apiKey").id }`.
- **Modify** `apps/gateway/src/routes/fixo/mcp/tools.ts` — use `ctx.apiKeyId` in diagnose +
  record_outcome.
- **Modify** `apps/agent/src/fixo/fixo-brain.ts` — `diagnoseForApi`/`openPrediction` stamp
  `api_key_id`; `recordOutcome` checks ownership.
- **Modify** `apps/gateway/src/routes/fixo/mcp/tools.ts` + `apps/gateway/src/routes/fixo/api.ts` —
  input bounds (symptom ≤2000, dtcs ≤20).
- **Create** `apps/fixo-web/src/app/(app)/settings/api-keys/page.tsx` + a link from the settings
  page.

---

### Task 1: Migration 0033 + Drizzle schema

**Files:**

- Create: `apps/agent/migrations/0033_api_key_ownership.sql`
- Modify: `packages/shared/src/db/schema.ts`

**Interfaces:**

- Produces: `fixoApiKeys.userId`, `fixoPredictions.apiKeyId`, `fixoRateLimit` table (`keyId`,
  `bucket`, `count`).

- [ ] **Step 1: Write the migration (idempotent, authored — NOT applied)**

```sql
-- 0033_api_key_ownership.sql — self-serve key ownership + per-key rate limiting.
-- Authored; apply post-deploy via psql -f (db:migrate skips hand-written SQL).
BEGIN;

-- Owner of a self-serve key (NULL for operator/manually-minted keys).
ALTER TABLE fixo_api_keys  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES user_profiles(id);
-- Which key created a prediction (NULL for in-process/legacy predictions).
ALTER TABLE fixo_predictions ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES fixo_api_keys(id);

CREATE INDEX IF NOT EXISTS fixo_api_keys_user_id_idx ON fixo_api_keys(user_id);

-- Fixed-window rate-limit counters. bucket = e.g. 'min:2026-06-22T16:45' / 'day:2026-06-22'.
CREATE TABLE IF NOT EXISTS fixo_rate_limit (
  key_id  uuid NOT NULL,
  bucket  text NOT NULL,
  count   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, bucket)
);

COMMIT;
```

- [ ] **Step 2: Add to the Drizzle schema**

In `packages/shared/src/db/schema.ts`: add to `fixoApiKeys`
`userId: uuid("user_id").references(() => userProfiles.id)`; add to `fixoPredictions`
`apiKeyId: uuid("api_key_id").references(() => fixoApiKeys.id)`; add a new table:

```ts
export const fixoRateLimit = pgTable("fixo_rate_limit", {
  keyId: uuid("key_id").notNull(),
  bucket: text("bucket").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.keyId, t.bucket] })]);
```

(Match the file's existing import style for `primaryKey`/`integer`/`text`/`uuid` — they're already
used elsewhere in this file.)

- [ ] **Step 3: Type-check**

Run: `deno task check` Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/migrations/0033_api_key_ownership.sql packages/shared/src/db/schema.ts
git commit -m "feat(fixo): schema for self-serve key ownership + rate-limit (migration 0033, authored)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: User-scoped key lib + session-authed `/keys` endpoints

**Files:**

- Modify: `apps/agent/src/fixo/lib/api-keys.ts`
- Modify: `apps/agent/src/mod.ts`
- Create: `apps/gateway/src/routes/fixo/keys.ts`
- Modify: `apps/gateway/src/fixo-app.ts`
- Test: `apps/agent/src/fixo/lib/api-keys_test.ts` (extend the existing pure test)

**Interfaces:**

- Consumes: existing `generateApiKey()` → `{ key, hash }`, `db`, `schema`.
- Produces: `createApiKeyForUser(userId, label?) → { id, key, label }`;
  `listApiKeysForUser(userId) → { id, label, createdAt, lastUsedAt, revoked }[]`;
  `revokeApiKeyForUser(userId, id) → boolean` (false if not owned/not found). Router `keys` mounted
  at `/keys` under `requireAuth` (reads `c.get("auth").userId`).

- [ ] **Step 1: Add the user-scoped functions to api-keys.ts**

```ts
// append to apps/agent/src/fixo/lib/api-keys.ts
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../../db/client.ts";

export async function createApiKeyForUser(
  userId: string,
  label?: string,
): Promise<{ id: string; key: string; label: string | null }> {
  const { key, hash } = generateApiKey();
  const [row] = await db.insert(schema.fixoApiKeys)
    .values({ keyHash: hash, label: label ?? null, userId })
    .returning({ id: schema.fixoApiKeys.id, label: schema.fixoApiKeys.label });
  return { id: row.id, key, label: row.label };
}

export async function listApiKeysForUser(userId: string) {
  const rows = await db.select({
    id: schema.fixoApiKeys.id,
    label: schema.fixoApiKeys.label,
    createdAt: schema.fixoApiKeys.createdAt,
    lastUsedAt: schema.fixoApiKeys.lastUsedAt,
    revokedAt: schema.fixoApiKeys.revokedAt,
  }).from(schema.fixoApiKeys)
    .where(eq(schema.fixoApiKeys.userId, userId))
    .orderBy(desc(schema.fixoApiKeys.createdAt));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    revoked: r.revokedAt !== null,
  }));
}

/** Revoke only if the key belongs to userId AND is not already revoked. */
export async function revokeApiKeyForUser(userId: string, id: string): Promise<boolean> {
  const updated = await db.update(schema.fixoApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(schema.fixoApiKeys.id, id),
      eq(schema.fixoApiKeys.userId, userId),
      isNull(schema.fixoApiKeys.revokedAt),
    ))
    .returning({ id: schema.fixoApiKeys.id });
  return updated.length > 0;
}
```

- [ ] **Step 2: Export from mod.ts**

```ts
export {
  createApiKeyForUser,
  listApiKeysForUser,
  revokeApiKeyForUser,
} from "./fixo/lib/api-keys.ts";
```

- [ ] **Step 3: Create the keys router**

```ts
// apps/gateway/src/routes/fixo/keys.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createApiKeyForUser, listApiKeysForUser, revokeApiKeyForUser } from "@hmls/agent";
import type { AuthContext } from "../../middleware/fixo/auth.ts";

const createInput = z.object({ label: z.string().max(80).optional() });

export const keys = new Hono<{ Variables: { auth: AuthContext } }>();

keys.get("/", async (c) => c.json({ keys: await listApiKeysForUser(c.get("auth").userId) }));

keys.post("/", zValidator("json", createInput), async (c) => {
  const { label } = c.req.valid("json");
  const created = await createApiKeyForUser(c.get("auth").userId, label);
  return c.json(created, 201); // { id, key, label } — `key` is the plaintext, shown once
});

keys.delete("/:id", async (c) => {
  const ok = await revokeApiKeyForUser(c.get("auth").userId, c.req.param("id"));
  if (!ok) return c.json({ error: { code: "NOT_FOUND", message: "Key not found" } }, 404);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Mount it under requireAuth in fixo-app.ts**

Add the import (near the other route imports) and, alongside the other `requireAuth` mounts (after
line ~111):

```ts
import { keys } from "./routes/fixo/keys.ts";
// ...
app.use("/keys", requireAuth);
app.use("/keys/*", requireAuth);
app.route("/keys", keys);
```

- [ ] **Step 5: Type-check + commit**

Run: `deno task check` (clean).

```bash
git add apps/agent/src/fixo/lib/api-keys.ts apps/agent/src/mod.ts apps/gateway/src/routes/fixo/keys.ts apps/gateway/src/fixo-app.ts
git commit -m "feat(fixo): self-serve key mint/list/revoke endpoints (session-authed)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Rate limit + input bounds (the abuse gate)

**Files:**

- Create: `apps/agent/src/fixo/lib/rate-limit.ts`
- Create: `apps/agent/src/fixo/lib/rate-limit_test.ts`
- Modify: `apps/agent/src/mod.ts` (export `checkRateLimit`)
- Modify: `apps/gateway/src/middleware/fixo/api-key.ts` (enforce after verify)
- Modify: `apps/gateway/src/routes/fixo/mcp/tools.ts` + `apps/gateway/src/routes/fixo/api.ts` (input
  bounds)

**Interfaces:**

- Produces: pure `bucketKeys(now: Date) → { min: string; day: string }`;
  `checkRateLimit(keyId: string) → Promise<{ ok: true } | { ok: false; scope: "min"|"day" }>`;
  `RATE_LIMITS = { perMin: 20, perDay: 200 }`.

- [ ] **Step 1: Write the failing pure bucket test**

```ts
// rate-limit_test.ts
import { assertEquals } from "jsr:@std/assert";
import { bucketKeys } from "./rate-limit.ts";

Deno.test("bucketKeys — minute + day buckets from a fixed instant", () => {
  const b = bucketKeys(new Date("2026-06-22T16:45:30Z"));
  assertEquals(b.min, "min:2026-06-22T16:45");
  assertEquals(b.day, "day:2026-06-22");
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `deno test apps/agent/src/fixo/lib/rate-limit_test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement rate-limit.ts**

```ts
// rate-limit.ts
import { sql } from "drizzle-orm";
import { db, schema } from "../../db/client.ts";

export const RATE_LIMITS = { perMin: 20, perDay: 200 } as const;

/** Pure: fixed-window bucket keys for a given instant. */
export function bucketKeys(now: Date): { min: string; day: string } {
  const iso = now.toISOString();
  return { min: `min:${iso.slice(0, 16)}`, day: `day:${iso.slice(0, 10)}` };
}

async function bump(keyId: string, bucket: string): Promise<number> {
  // Atomic upsert-increment; returns the new count for this window.
  const [row] = await db.insert(schema.fixoRateLimit)
    .values({ keyId, bucket, count: 1 })
    .onConflictDoUpdate({
      target: [schema.fixoRateLimit.keyId, schema.fixoRateLimit.bucket],
      set: { count: sql`${schema.fixoRateLimit.count} + 1` },
    })
    .returning({ count: schema.fixoRateLimit.count });
  return row.count;
}

/** Increment both windows; over either limit → not ok. Date is runtime-only
 *  (gateway request handler, not a workflow script — `new Date()` is fine). */
export async function checkRateLimit(
  keyId: string,
): Promise<{ ok: true } | { ok: false; scope: "min" | "day" }> {
  const { min, day } = bucketKeys(new Date());
  const minCount = await bump(keyId, min);
  if (minCount > RATE_LIMITS.perMin) return { ok: false, scope: "min" };
  const dayCount = await bump(keyId, day);
  if (dayCount > RATE_LIMITS.perDay) return { ok: false, scope: "day" };
  return { ok: true };
}
```

- [ ] **Step 4: Run the test → PASS.** `deno test apps/agent/src/fixo/lib/rate-limit_test.ts`

- [ ] **Step 5: Enforce in the api-key middleware**

In `apps/gateway/src/middleware/fixo/api-key.ts`, after `verifyApiKey` succeeds, call
`checkRateLimit(verified.id)`; if not ok, return 429:

```ts
import { checkRateLimit } from "@hmls/agent"; // add export in mod.ts
// ...inside authenticateApiKey, after `const verified = await verifyApiKey(key); if (!verified) ...`:
const rl = await checkRateLimit(verified.id);
if (!rl.ok) {
  return new Response(
    JSON.stringify({
      error: { code: "RATE_LIMITED", message: `Rate limit exceeded (${rl.scope})` },
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": rl.scope === "min" ? "60" : "3600",
      },
    },
  );
}
return verified;
```

Add `export { checkRateLimit, RATE_LIMITS } from "./fixo/lib/rate-limit.ts";` to mod.ts.

- [ ] **Step 6: Input bounds**

In `apps/gateway/src/routes/fixo/mcp/tools.ts` (the `diagnose` tool's zod input) AND
`apps/gateway/src/routes/fixo/api.ts` (the `/v1/diagnose` zod input), tighten:
`symptom: z.string().min(1).max(2000)` and `dtcs: z.array(z.string().max(20)).max(20).optional()`.
(Body-size: Hono on Deno — rely on the zod bound + the JSON parse; a 32KB hard cap is deferred
unless trivially available. Note it in the report if not added.)

- [ ] **Step 7: Type-check + full fixo tests + commit**

Run: `deno task check` (clean);
`deno test apps/agent/src/fixo/lib/ apps/gateway/src/routes/fixo/mcp/` (rate-limit + jsonrpc +
compat pass).

```bash
git add apps/agent/src/fixo/lib/rate-limit.ts apps/agent/src/fixo/lib/rate-limit_test.ts apps/agent/src/mod.ts apps/gateway/src/middleware/fixo/api-key.ts apps/gateway/src/routes/fixo/mcp/tools.ts apps/gateway/src/routes/fixo/api.ts
git commit -m "feat(fixo): per-key rate limit (DB fixed-window) + input bounds on the diagnose surface

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Thread the calling key into the MCP tools + record_outcome ownership

**Files:**

- Modify: `apps/gateway/src/routes/fixo/mcp/jsonrpc.ts`
- Modify: `apps/gateway/src/routes/fixo/mcp/route.ts`
- Modify: `apps/gateway/src/routes/fixo/mcp/tools.ts`
- Modify: `apps/agent/src/fixo/fixo-brain.ts`
- Test: `apps/gateway/src/routes/fixo/mcp/jsonrpc_test.ts` (extend)

**Interfaces:**

- `handleMcpMessage(msg, tools, serverInfo, ctx?: McpCallCtx)` where
  `McpCallCtx = { apiKeyId?: string }`; `McpTool.execute(args, ctx?: McpCallCtx)`.
- `diagnoseForApi(req, apiKeyId?)` stamps `fixo_predictions.api_key_id`.
  `recordOutcome({ predictionId, confirmedDiagnosis, actualCostCents }, callerKeyId?)` rejects when
  the prediction's `api_key_id` is set and ≠ callerKeyId.

- [ ] **Step 1: Failing test — execute receives ctx**

Extend `jsonrpc_test.ts`:

```ts
Deno.test("tools/call threads ctx to execute", async () => {
  let seen: unknown;
  const tools = [{
    name: "echo",
    description: "x",
    inputSchema: z.object({}),
    execute: (_args: unknown, ctx?: { apiKeyId?: string }) => {
      seen = ctx?.apiKeyId;
      return { content: [{ type: "text", text: "ok" }] };
    },
  }];
  await handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: {} } },
    tools,
    { name: "t", version: "0" },
    { apiKeyId: "key-123" },
  );
  assertEquals(seen, "key-123");
});
```

- [ ] **Step 2: Run → FAIL** (execute gets no ctx).
      `deno test apps/gateway/src/routes/fixo/mcp/jsonrpc_test.ts`

- [ ] **Step 3: Thread ctx through jsonrpc.ts**

Add `export interface McpCallCtx { apiKeyId?: string }`; change `McpTool.execute` to
`(args: unknown, ctx?: McpCallCtx) => Promise<McpToolResult> | McpToolResult`; change
`handleMcpMessage(msg, tools, serverInfo, ctx?: McpCallCtx)` and in the `tools/call` branch call
`await tool.execute(parsed.data, ctx)`.

- [ ] **Step 4: Run → PASS** + the existing 8 tests still pass.

- [ ] **Step 5: Pass ctx from the route**

In `mcp/route.ts`: `const apiKey = c.get("apiKey") as { id: string } | undefined;` then
`handleMcpMessage(msg as any, fixoMcpTools, SERVER_INFO, { apiKeyId: apiKey?.id })`. (Add the
`apiKey` to the route's Hono `Variables` type or cast.)

- [ ] **Step 6: Use ctx in the tools + brain**

`tools.ts`: `diagnose.execute(args, ctx)` → `diagnoseForApi({...}, ctx?.apiKeyId)`;
`record_outcome.execute(args, ctx)` → `recordOutcome({...}, ctx?.apiKeyId)`.

`fixo-brain.ts`:

- `openPrediction(req, apiKeyId?)` → insert `apiKeyId: apiKeyId ?? null`.
  `diagnoseForApi(req, apiKeyId?)` passes it through.
- `recordOutcome(req, callerKeyId?)`: before updating, read the prediction's `apiKeyId`; if it is
  non-null and `!== callerKeyId`, return without writing + log a warn
  (`"record_outcome ownership mismatch"`). NULL owner (legacy/manual) → allow. Then the existing
  update.

(Note: the in-process `create_order` caller of `openPrediction`/`recordOutcome` passes no apiKeyId →
NULL owner → unchanged behavior. Verify those call sites still compile with the new optional param.)

- [ ] **Step 7: Type-check + tests + commit**

Run: `deno task check` (clean); `deno test apps/gateway/src/routes/fixo/mcp/ apps/agent/src/fixo/`
(all pass).

```bash
git add apps/gateway/src/routes/fixo/mcp/jsonrpc.ts apps/gateway/src/routes/fixo/mcp/jsonrpc_test.ts apps/gateway/src/routes/fixo/mcp/route.ts apps/gateway/src/routes/fixo/mcp/tools.ts apps/agent/src/fixo/fixo-brain.ts
git commit -m "feat(fixo-mcp): thread calling key into tools; record_outcome ownership check

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: fixo-web "API keys" page

**Files:**

- Create: `apps/fixo-web/src/app/(app)/settings/api-keys/page.tsx`
- Modify: `apps/fixo-web/src/app/(app)/settings/page.tsx` (add a link to /settings/api-keys)

**Interfaces:**

- Consumes: gateway `GET/POST /keys`, `DELETE /keys/:id` (Task 2) via `AGENT_URL`
  (`apps/fixo-web/src/lib/config.ts`) + `useAuth().session.access_token` Bearer.

- [ ] **Step 1: Build the page (client component)**

Mirror `settings/page.tsx` structure (client component, `useAuth()`, `AGENT_URL`, section/card
styling). It must:

- On load (when `session?.access_token`): `GET ${AGENT_URL}/keys` → render the list (label, created,
  last used, a Revoke button per key). Empty state when none.
- "Create key" button → `POST ${AGENT_URL}/keys` `{ label }` → show the returned `key` plaintext
  ONCE in a highlighted block with a copy button (native `navigator.clipboard.writeText` + `copied`
  state, per the FixoEstimateCard pattern), and a "you won't see this again" note. Append the new
  key (without plaintext) to the list.
- Revoke → `DELETE ${AGENT_URL}/keys/:id` → on ok, mark/remove the row.
- A **getting-started** card: the MCP endpoint `https://api.fixo.ink/v1/mcp` + a one-line "add this
  to your MCP client with header `Authorization: Bearer <your key>`". Do NOT mention `/v1/diagnose`.
  All fetches send `headers: { Authorization: \`Bearer ${session.access_token}\` }`. Handle
  loading + error states like the settings page.

- [ ] **Step 2: Link it from settings**

In `settings/page.tsx`, add a row/link to `/settings/api-keys` ("API keys" / "Developer access") in
an appropriate section, matching the existing settings-row pattern.

- [ ] **Step 3: Verify web**

Run: `cd apps/fixo-web && bun run lint && bun run typecheck && bun run test` Expected: all clean.

- [ ] **Step 4: Build**

Run: `cd apps/fixo-web && infisical run --env=dev -- bun run build` Expected: build succeeds (the
new route prerenders/compiles).

- [ ] **Step 5: Commit**

```bash
git add apps/fixo-web/src/app/(app)/settings/api-keys/page.tsx apps/fixo-web/src/app/(app)/settings/page.tsx
git commit -m "feat(fixo-web): self-serve API keys page (create/list/revoke + MCP getting-started)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deferred (NOT in this plan)

Usage dashboards/metering; monetization (credits/tiers); per-tool scopes; org/team keys; a
standalone developer portal; hard per-endpoint key scoping (e.g. blocking self-serve keys from
`/v1/diagnose` — for now it's just undocumented); a `fixo_rate_limit` cleanup job for stale buckets
(rows are ignored by the current-bucket WHERE; prune later if the table grows).

## Post-deploy

After merge + deploy, apply `0033_api_key_ownership.sql` via psql -f (Infisical = prod). Until
applied, `createApiKeyForUser`/the `api_key_id` stamp will error (column missing) — so the
self-serve UI must not be exercised in prod before the migration lands.

## Risks

- **`new Date()` in rate-limit.ts** is runtime gateway code (NOT a workflow script), so it's allowed
  — call this out so a reviewer doesn't flag it against the workflow-script rule.
- **Fixed-window edge burst:** a caller can do up to `2×perMin` across a minute boundary. Acceptable
  for free-tier abuse protection; revisit with a sliding window if metering matters.
- **`record_outcome` NULL-owner:** legacy/in-process predictions have NULL `api_key_id` → allowed
  for any caller. That's intended (operator/internal), but means an external key could close an
  internal prediction's outcome if it guesses the id. Low risk (ids are uuids); note for the
  external-hardening follow-up.
- **fixo-web route group:** confirm the `(app)/settings/api-keys/` path renders under the existing
  auth-gated layout (the `(app)` group). If settings uses a different auth guard, mirror it.
- **Rate limit counts ALL `/v1/*` requests** (it lives in the api-key middleware), including the MCP
  handshake (`initialize`, `tools/list`) — not just the expensive `tools/call diagnose`. So a
  session's ~2-request handshake eats into the 20/min budget. Fine for v1 (tune the numbers); if it
  bites, move the limit to only the `diagnose` tool-call (the middleware would have to peek the
  JSON-RPC method, or do it inside the tool).
