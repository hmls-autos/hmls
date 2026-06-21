// Single source of truth for SEO-critical URLs.
//
// SITE_URL is the canonical fixo public domain (fixo.ink — see CLAUDE.md
// product direction §Production URLs). Several legacy files still embed
// the pre-launch fixo.hmls.autos domain; Lane C of the推广 plan sweeps
// them in one go.
//
// GATEWAY_URL is the public API base — funnel beacons, agent /task,
// session input, etc. all route here. Falls back to localhost for dev.

export const SITE_URL = "https://fixo.ink";

export const GATEWAY_URL =
  process.env.NEXT_PUBLIC_AGENT_URL || "https://api.fixo.ink";
