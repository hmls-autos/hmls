// Minimal Slack incoming-webhook helper.
//
// Posts a plain-text message to the channel configured by SLACK_WEBHOOK_URL.
// Used for low-frequency operational alerts (kill-criteria signals, cost
// overruns, manual review prompts) — NOT for high-volume telemetry. For
// telemetry use the funnel_events table; for kill alerts use this.
//
// Failure semantics: never throws on network/webhook errors — Slack
// outages must not cascade into the caller. Returns true/false so the
// caller can log if needed.

import { env } from "@hmls/shared/env";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["hmls", "agent", "slack"]);

export interface SlackMessageOptions {
  /** Override the env-configured webhook URL. */
  webhookUrl?: string;
  /** Markdown-style text body (Slack supports limited mrkdwn). */
  text: string;
  /** Optional thread parent ts to reply in-thread. */
  threadTs?: string;
}

/**
 * Post a message to Slack via incoming webhook.
 * Returns true on 200, false on any failure. Never throws.
 */
export async function postSlackMessage(opts: SlackMessageOptions): Promise<boolean> {
  const url = opts.webhookUrl ?? env("SLACK_WEBHOOK_URL");
  if (!url) {
    logger.warn("SLACK_WEBHOOK_URL not configured; message dropped");
    return false;
  }

  const payload: Record<string, unknown> = { text: opts.text };
  if (opts.threadTs) payload.thread_ts = opts.threadTs;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.warn("Slack webhook non-2xx response", {
        status: res.status,
        body: body.slice(0, 200),
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("Slack webhook fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
