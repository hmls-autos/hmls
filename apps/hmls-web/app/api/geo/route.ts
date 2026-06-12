import { type NextRequest, NextResponse } from "next/server";

/**
 * Coarse visitor coordinates from Vercel's IP geolocation headers.
 * Used by RealMap to pick the initial map view (nearest metro). Returns
 * nulls outside Vercel (local dev) or when geo is unavailable — the map
 * falls back to the dual-metro overview.
 */
export function GET(req: NextRequest) {
  const lat = req.headers.get("x-vercel-ip-latitude");
  const lng = req.headers.get("x-vercel-ip-longitude");
  return NextResponse.json(
    {
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
    },
    // Per-visitor answer — never cache shared.
    { headers: { "cache-control": "private, no-store" } },
  );
}
