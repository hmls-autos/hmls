// Kill-criteria signals for the fixo Speed Wedge 30-day推广 plan
// (CEO plan 2026-05-14, D5 kill criteria).
//
// Computes the queryable signals only. Two of the three kill criteria
// from the CEO plan are NOT computable from funnel_events alone:
//   - "ChatGPT parity in ≥80% scenarios" → manual qualitative test
//   - "GSC impressions = 0" → Google Search Console API (separate work)
// Those stay as manual / external checks. This module covers the
// SQL-derivable signals only.
//
// Signal definitions:
//   - hmlsRejectionClicks: count of channel='hmls' event_name='hmls_rejection_click'
//     over the last 7 days. CEO plan threshold: < 5% CTR fires the kill.
//     CTR denominator (emails sent) lives in the orders table — caller
//     pairs the click count with their own send count.
//   - seoPageViewsByCode: top-N OBD codes by page-view count, last 7 days.
//     Sparse / empty = SEO matrix not catching on.
//   - firstDiagnosisConversion: of users who did a first diagnosis in
//     the last 30 days, how many later did a paid top-up (any time
//     within that window). CEO plan's success criterion #2.
//   - channelMix: clicks per channel in the last 7 days. Diversification
//     check — heavy concentration on one channel means others aren't
//     working and推广 is fragile.
//
// All windows are wall-clock now() relative — caller decides cadence
// (daily, weekly, on-demand).

import { and, count, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "../db/client.ts";

export interface SeoPageView {
  obdCode: string;
  views: number;
}

export interface ChannelClick {
  channel: string;
  clicks: number;
}

export interface KillCriteriaSignals {
  computedAt: string;
  windowDays: number;
  hmlsRejectionClicks: number;
  seoPageViewsByCode: SeoPageView[];
  firstDiagnosisCount: number;
  paidConversions: number;
  conversionPct: number;
  channelMix: ChannelClick[];
}

const DEFAULT_WINDOW_DAYS = 7;
const CONVERSION_WINDOW_DAYS = 30;

/**
 * Run all SQL kill-criteria signals against the funnel_events table.
 * Returns a structured payload suitable for logging, Slack rendering,
 * or comparison against thresholds.
 *
 * Safe to call when no events have been recorded yet — all queries
 * return 0 / empty array, not errors.
 */
export async function computeKillSignals(
  opts: { windowDays?: number } = {},
): Promise<KillCriteriaSignals> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const windowStart = sql`now() - (${windowDays}::int * interval '1 day')`;
  const conversionStart = sql`now() - (${CONVERSION_WINDOW_DAYS}::int * interval '1 day')`;

  const [hmlsRow] = await db
    .select({ count: count() })
    .from(schema.funnelEvents)
    .where(
      and(
        eq(schema.funnelEvents.channel, "hmls"),
        eq(schema.funnelEvents.eventName, "hmls_rejection_click"),
        gt(schema.funnelEvents.createdAt, windowStart),
      ),
    );

  const seoRows = await db
    .select({
      obdCode: schema.funnelEvents.channelDetail,
      views: count(),
    })
    .from(schema.funnelEvents)
    .where(
      and(
        eq(schema.funnelEvents.channel, "seo"),
        eq(schema.funnelEvents.eventName, "seo_page_view"),
        gt(schema.funnelEvents.createdAt, windowStart),
      ),
    )
    .groupBy(schema.funnelEvents.channelDetail)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  const channelRows = await db
    .select({
      channel: schema.funnelEvents.channel,
      clicks: count(),
    })
    .from(schema.funnelEvents)
    .where(gt(schema.funnelEvents.createdAt, windowStart))
    .groupBy(schema.funnelEvents.channel)
    .orderBy(sql`count(*) desc`);

  // first_diagnosis → paid_top_up conversion (30-day window).
  // A user "converted" if they had at least one first_diagnosis AND at
  // least one paid_top_up, both within the conversion window. The
  // ordering (paid_top_up after first_diagnosis) is intentionally NOT
  // enforced — users sometimes pay first to top up before their first
  // chat, and we still want to count that as a converted user.
  const conversionRow = await db
    .select({
      firstDx: sql<number>`
        count(distinct case when ${schema.funnelEvents.eventName} = 'first_diagnosis'
          and ${schema.funnelEvents.userId} is not null
          then ${schema.funnelEvents.userId} end)
      `,
      paid: sql<number>`
        count(distinct case when ${schema.funnelEvents.eventName} = 'paid_top_up'
          and ${schema.funnelEvents.userId} is not null
          and exists (
            select 1 from fixo_funnel_events fe2
            where fe2.user_id = ${schema.funnelEvents.userId}
              and fe2.event_name = 'first_diagnosis'
              and fe2.created_at > ${conversionStart}
          )
          then ${schema.funnelEvents.userId} end)
      `,
    })
    .from(schema.funnelEvents)
    .where(gt(schema.funnelEvents.createdAt, conversionStart));

  const firstDiagnosisCount = Number(conversionRow[0]?.firstDx ?? 0);
  const paidConversions = Number(conversionRow[0]?.paid ?? 0);
  const conversionPct = firstDiagnosisCount === 0
    ? 0
    : Math.round((paidConversions / firstDiagnosisCount) * 1000) / 10;

  return {
    computedAt: new Date().toISOString(),
    windowDays,
    hmlsRejectionClicks: Number(hmlsRow?.count ?? 0),
    seoPageViewsByCode: seoRows.map((r) => ({
      obdCode: r.obdCode ?? "(unknown)",
      views: Number(r.views),
    })),
    firstDiagnosisCount,
    paidConversions,
    conversionPct,
    channelMix: channelRows.map((r) => ({
      channel: r.channel,
      clicks: Number(r.clicks),
    })),
  };
}

/**
 * Render kill-criteria signals as a Slack-friendly markdown block.
 * Caller decides when to post (e.g. only when a threshold is crossed,
 * or on a daily summary cadence).
 */
export function renderKillSignalsForSlack(signals: KillCriteriaSignals): string {
  const lines: string[] = [];
  lines.push(`*Fixo推广 kill-criteria signals* — last ${signals.windowDays} days`);
  lines.push(`_Computed: ${signals.computedAt}_`);
  lines.push("");
  lines.push(`• HMLS rejection clicks: *${signals.hmlsRejectionClicks}*`);
  lines.push(
    `• First diagnosis → paid top-up: *${signals.paidConversions}/${signals.firstDiagnosisCount}* (${signals.conversionPct}%, 30-day window)`,
  );
  lines.push("");
  if (signals.channelMix.length === 0) {
    lines.push("• Channel mix: (no events yet)");
  } else {
    lines.push("• Channel mix:");
    for (const row of signals.channelMix) {
      lines.push(`    • ${row.channel}: ${row.clicks}`);
    }
  }
  if (signals.seoPageViewsByCode.length > 0) {
    lines.push("");
    lines.push("• Top SEO page views:");
    for (const row of signals.seoPageViewsByCode.slice(0, 10)) {
      lines.push(`    • ${row.obdCode}: ${row.views}`);
    }
  }
  return lines.join("\n");
}
