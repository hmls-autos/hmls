/**
 * Marker data + view logic for the service-coverage map (RealMap).
 *
 * A curated, representative subset of the served cities in
 * `lib/seo-content.ts` CITIES — not every served city gets a marker, but
 * every marker MUST be a served city (enforced by lib/map-cities.test.ts).
 * Kept in a pure module (no leaflet imports) so bun:test can load it.
 */

import { REGIONS, type RegionId } from "./business";

export interface MapCity {
  /** Must match a `CITIES` entry's `name` (and region) in lib/seo-content.ts. */
  name: string;
  region: RegionId;
  /** [lat, lng] */
  coords: [number, number];
}

export const SERVICE_CITIES: readonly MapCity[] = [
  // Orange County
  { name: "Irvine", region: "oc", coords: [33.6846, -117.8265] },
  { name: "Santa Ana", region: "oc", coords: [33.7455, -117.8677] },
  { name: "Newport Beach", region: "oc", coords: [33.6189, -117.9289] },
  { name: "Anaheim", region: "oc", coords: [33.8366, -117.9143] },
  { name: "Huntington Beach", region: "oc", coords: [33.6595, -117.9988] },
  { name: "Mission Viejo", region: "oc", coords: [33.6, -117.672] },
  // San Jose / South Bay
  { name: "San Jose", region: "sj", coords: [37.3382, -121.8863] },
  { name: "Santa Clara", region: "sj", coords: [37.3541, -121.9552] },
  { name: "Sunnyvale", region: "sj", coords: [37.3688, -122.0363] },
  { name: "Mountain View", region: "sj", coords: [37.3861, -122.0839] },
  { name: "Cupertino", region: "sj", coords: [37.323, -122.0322] },
  { name: "Milpitas", region: "sj", coords: [37.4323, -121.8996] },
  { name: "Los Gatos", region: "sj", coords: [37.2358, -121.9624] },
];

/** Camera scope: one metro, or the dual-metro overview. */
export type MapView = RegionId | "all";

/**
 * Bounds for a view, derived from the marker data — adding a city can never
 * clip off-view. Returned as a LatLngTuple[] (leaflet fits the enclosing box).
 */
export function boundsForView(view: MapView): [number, number][] {
  const cities =
    view === "all"
      ? SERVICE_CITIES
      : SERVICE_CITIES.filter((c) => c.region === view);
  return cities.map((c) => c.coords);
}

/**
 * Max distance (km) from a metro base for IP-based view personalization.
 * Beyond this, the visitor sees the dual-metro overview instead of being
 * zoomed into a metro they're nowhere near.
 */
const NEAREST_REGION_MAX_KM = 400;

/**
 * Pick the metro nearest to a visitor coordinate (from Vercel geo headers),
 * or null when the visitor is too far from both bases (→ "all" view).
 * Equirectangular approximation — plenty for comparing two CA metros.
 */
export function nearestRegion(lat: number, lng: number): RegionId | null {
  let best: { region: RegionId; km: number } | null = null;
  for (const region of Object.values(REGIONS)) {
    const dLat = lat - region.geo.latitude;
    const dLng = (lng - region.geo.longitude) * Math.cos((lat * Math.PI) / 180);
    const km = Math.sqrt(dLat * dLat + dLng * dLng) * 111.32;
    if (!best || km < best.km) best = { region: region.id, km };
  }
  return best && best.km <= NEAREST_REGION_MAX_KM ? best.region : null;
}
