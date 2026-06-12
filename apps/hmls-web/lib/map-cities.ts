/**
 * Marker data for the homepage/contact service-coverage map (RealMap).
 *
 * A curated, representative subset of the served cities in
 * `lib/seo-content.ts` CITIES — not every served city gets a marker, but
 * every marker MUST be a served city (enforced by lib/map-cities.test.ts).
 * Kept in a pure module (no leaflet imports) so bun:test can load it.
 */

export interface MapCity {
  /** Must match a `CITIES` entry's `name` in lib/seo-content.ts. */
  name: string;
  /** [lat, lng] */
  coords: [number, number];
}

export const SERVICE_CITIES: readonly MapCity[] = [
  // Orange County
  { name: "Irvine", coords: [33.6846, -117.8265] },
  { name: "Santa Ana", coords: [33.7455, -117.8677] },
  { name: "Newport Beach", coords: [33.6189, -117.9289] },
  { name: "Anaheim", coords: [33.8366, -117.9143] },
  { name: "Huntington Beach", coords: [33.6595, -117.9988] },
  { name: "Mission Viejo", coords: [33.6, -117.672] },
  // San Jose / South Bay
  { name: "San Jose", coords: [37.3382, -121.8863] },
  { name: "Santa Clara", coords: [37.3541, -121.9552] },
  { name: "Sunnyvale", coords: [37.3688, -122.0363] },
  { name: "Mountain View", coords: [37.3861, -122.0839] },
  { name: "Cupertino", coords: [37.323, -122.0322] },
  { name: "Milpitas", coords: [37.4323, -121.8996] },
  { name: "Los Gatos", coords: [37.2358, -121.9624] },
];
