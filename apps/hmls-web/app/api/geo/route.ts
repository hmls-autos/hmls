import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Coarse visitor coordinates from Cloudflare's edge geolocation (request.cf).
 * Used by RealMap to pick the initial map view (nearest metro). Returns nulls
 * when geo is unavailable — off the CF runtime (local `next dev` / tests) or
 * when `cf` is absent — and the map falls back to the dual-metro overview.
 *
 * request.cf.latitude/longitude are populated by workerd with no zone config
 * (unlike the CF-IP* headers, which need IP Geolocation enabled on the zone).
 */
export function GET(_req: NextRequest) {
  let lat: number | null = null;
  let lng: number | null = null;
  try {
    const cf = getCloudflareContext().cf as
      | { latitude?: string; longitude?: string }
      | undefined;
    if (cf?.latitude) lat = Number(cf.latitude);
    if (cf?.longitude) lng = Number(cf.longitude);
  } catch {
    // Not on the CF runtime — fall through to nulls (RealMap handles it).
  }
  return NextResponse.json(
    { lat, lng },
    // Per-visitor answer — never cache shared.
    { headers: { "cache-control": "private, no-store" } },
  );
}
