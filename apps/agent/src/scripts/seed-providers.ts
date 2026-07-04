/**
 * Seed a default mechanic (provider) + weekly availability.
 *
 * Idempotent — safe to re-run. Reads name/email from env or uses defaults.
 *
 * Run: deno task --cwd apps/agent db:seed-providers
 */

import { eq } from "drizzle-orm";
import { dbAdmin, schema } from "../db/client.ts";

const DEFAULT_NAME = Deno.env.get("SEED_PROVIDER_NAME") ?? "HMLS Mechanic";
const DEFAULT_EMAIL = Deno.env.get("SEED_PROVIDER_EMAIL") ?? "mechanic@hmls.autos";

// Monday–Saturday 08:00–24:00 (matches the hours quoted in the agent system prompt)
const WEEKLY_HOURS: Array<{ dayOfWeek: number; startTime: string; endTime: string }> = [
  { dayOfWeek: 1, startTime: "08:00:00", endTime: "23:59:59" },
  { dayOfWeek: 2, startTime: "08:00:00", endTime: "23:59:59" },
  { dayOfWeek: 3, startTime: "08:00:00", endTime: "23:59:59" },
  { dayOfWeek: 4, startTime: "08:00:00", endTime: "23:59:59" },
  { dayOfWeek: 5, startTime: "08:00:00", endTime: "23:59:59" },
  { dayOfWeek: 6, startTime: "08:00:00", endTime: "23:59:59" },
];

async function main() {
  // Dev seed script — runs outside any tenant scope, so bypass RLS.
  const [existing] = await dbAdmin
    .select()
    .from(schema.providers)
    .where(eq(schema.providers.email, DEFAULT_EMAIL))
    .limit(1);

  let providerId: number;
  if (existing) {
    providerId = existing.id;
    console.log(`[seed] Provider already exists: #${providerId} (${existing.name})`);
  } else {
    const [created] = await dbAdmin
      .insert(schema.providers)
      .values({
        name: DEFAULT_NAME,
        email: DEFAULT_EMAIL,
        isActive: true,
        timezone: "America/Los_Angeles",
      })
      .returning();
    providerId = created.id;
    console.log(`[seed] Created provider #${providerId} (${created.name})`);
  }

  // Wipe and re-insert availability so re-runs keep schema in sync
  await dbAdmin
    .delete(schema.providerAvailability)
    .where(eq(schema.providerAvailability.providerId, providerId));

  await dbAdmin.insert(schema.providerAvailability).values(
    WEEKLY_HOURS.map((h) => ({ providerId, ...h })),
  );
  console.log(`[seed] Set weekly availability (${WEEKLY_HOURS.length} days)`);

  console.log(`[seed] Done. Provider ID: ${providerId}`);
}

if (import.meta.main) {
  await main();
  Deno.exit(0);
}
