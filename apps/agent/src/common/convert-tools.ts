import { withAdminScope, withTenantScope } from "../db/client.ts";
import { OWNER_ALL_SHOPS } from "../db/tenant.ts";

export interface ToolContext {
  userId?: string;
  customerId?: number;
  /** Staff chat: the admin's email, used to build the Actor for
   *  order-state writes. Absent for customer chat. */
  adminEmail?: string;
  /** Fixo chat: the active fixo_sessions.id. Required by tools that
   *  mutate session-scoped state (e.g. update_diagnostic_state). */
  fixoSessionId?: number;
  /** Multi-tenancy: the shop this chat session belongs to. Staff agent:
   *  may be OWNER_ALL_SHOPS for owner-wide reads. Customer agent: always
   *  a concrete shopId (resolved at first-contact upsert). */
  shopId?: string;
}

// deno-lint-ignore no-explicit-any
export interface LegacyTool<P = any> {
  name: string;
  description: string;
  // deno-lint-ignore no-explicit-any
  schema: any;
  execute: (params: P, ctx?: ToolContext) => Promise<unknown>;
}

/** AI SDK v7 strictly validates tool outputs as JSON values when it builds the
 *  next step's prompt (standardizePrompt) — a Date (e.g. create_order's
 *  expiresAt, get_order's scheduledAt) fails validation and kills the stream
 *  mid-turn as "An error occurred.". Round-trip through JSON so every tool
 *  result is exactly what the wire would carry (Dates → ISO strings). */
function toJsonSafe(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Convert existing tool arrays (name/schema/execute) to AI SDK tool records. */
// deno-lint-ignore no-explicit-any
export function convertTools(existingTools: LegacyTool[], ctx?: ToolContext): Record<string, any> {
  // deno-lint-ignore no-explicit-any
  const result: Record<string, any> = {};
  for (const t of existingTools) {
    result[t.name] = {
      description: t.description,
      inputSchema: t.schema,
      execute: async (input: unknown) => {
        // Owner viewing all shops → cross-shop read on the admin connection.
        if (ctx?.shopId === OWNER_ALL_SHOPS) {
          return toJsonSafe(await withAdminScope(() => t.execute(input, ctx)));
        }
        // A concrete shop (staff) or a customer → RLS-scoped transaction.
        if (ctx?.customerId != null || ctx?.shopId) {
          return toJsonSafe(
            await withTenantScope(
              { shopId: ctx.shopId, customerId: ctx.customerId },
              () => t.execute(input, ctx),
            ),
          );
        }
        // No tenant context (e.g. Fixo tools) → run unscoped on the base pool.
        // Fixo tables are not RLS'd; tenant_app has grants on them.
        return toJsonSafe(await t.execute(input, ctx));
      },
    };
  }
  return result;
}
