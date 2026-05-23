"use client";

// Client-side beacon that fires a POST /funnel/track event once per page
// view. Used by SEO landing pages so the推广 attribution data lands in
// fixo_funnel_events without requiring a server-side render of the
// route (SEO pages are SSG; the event has to fire from the browser).
//
// Why a client component instead of a server-side fetch in the route:
//   1. The page is SSG — there's no per-request server context to write
//      the event from.
//   2. Crawler hits would otherwise count as page views, inflating the
//      D5 kill-criteria signal. Real browsers run useEffect; bots don't.
//   3. The user's auth cookie (if any) reaches the gateway, so the
//      gateway can attribute the event to a known user via its own auth.
//
// Idempotency: useEffect with an empty dependency array fires once per
// mount, plus React 18 strict-mode double-effect in dev. We accept the
// possible dev double-count; production builds disable strict-mode
// double-invoke. For prod-tier accuracy we'd want a sessionStorage flag
// to dedupe within a session — deferred until the kill-criteria queries
// start tracking unique-viewers rather than event-counts.

import { useEffect } from "react";
import { GATEWAY_URL } from "@/lib/seo-config";

export interface FunnelBeaconProps {
  eventName: string;
  channel: string;
  channelDetail?: string;
}

export function FunnelBeacon({
  eventName,
  channel,
  channelDetail,
}: FunnelBeaconProps) {
  useEffect(() => {
    const controller = new AbortController();
    // Fire-and-forget. Beacon failures must not throw or display anything.
    fetch(`${GATEWAY_URL}/funnel/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // include auth cookie so gateway can attribute
      body: JSON.stringify({
        event_name: eventName,
        channel,
        channel_detail: channelDetail,
      }),
      signal: controller.signal,
    }).catch(() => {
      // Silent — telemetry endpoint failure shouldn't render anything.
    });
    return () => controller.abort();
  }, [eventName, channel, channelDetail]);

  return null;
}
