// Manual / cron-driven kill-criteria check for the fixo Speed Wedge 30-day推广 plan.
//
// Usage:
//   deno task --cwd apps/agent kill-criteria:check
//
// Behavior:
//   - Computes the SQL-queryable kill-criteria signals (see ../lib/kill-criteria.ts)
//   - Logs the structured payload to stdout (machine-readable JSON)
//   - Posts a human-readable summary to Slack if SLACK_WEBHOOK_URL is set
//   - Exits 0 on success, 1 on DB error (script-level failure)
//
// CEO plan reference: kill criteria require comparing these signals
// against thresholds (HMLS CTR < 5%, GSC impressions = 0, ChatGPT
// parity ≥ 80%). This script reports the CURRENT signal values; the
// threshold check is intentionally left to the operator until we have
// at least a week of baseline data — a 5% threshold on three clicks is
// meaningless.

import { computeKillSignals, renderKillSignalsForSlack } from "../lib/kill-criteria.ts";
import { postSlackMessage } from "../lib/slack.ts";

function parseArgs(argv: string[]): { windowDays?: number } {
  const opts: { windowDays?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--window") {
      const n = parseInt(argv[++i] ?? "", 10);
      if (Number.isFinite(n) && n > 0) opts.windowDays = n;
    } else if (arg.startsWith("--window=")) {
      const n = parseInt(arg.slice("--window=".length), 10);
      if (Number.isFinite(n) && n > 0) opts.windowDays = n;
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(Deno.args);
  const signals = await computeKillSignals(opts);

  console.log(JSON.stringify(signals, null, 2));

  if (Deno.env.get("SLACK_WEBHOOK_URL")) {
    const text = renderKillSignalsForSlack(signals);
    const posted = await postSlackMessage({ text });
    console.error(posted ? "[slack] posted" : "[slack] post failed (see logs)");
  } else {
    console.error("[slack] SLACK_WEBHOOK_URL not set — stdout only");
  }
}

if (import.meta.main) {
  try {
    await main();
    Deno.exit(0);
  } catch (err) {
    console.error("kill-criteria check failed:", err);
    Deno.exit(1);
  }
}
