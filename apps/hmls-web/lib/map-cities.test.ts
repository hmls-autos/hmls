import { expect, test } from "bun:test";
import { boundsForView, nearestRegion, SERVICE_CITIES } from "./map-cities";
import { CITIES } from "./seo-content";

test("marker list is non-empty (empty bounds would crash leaflet fitBounds)", () => {
  expect(SERVICE_CITIES.length).toBeGreaterThan(0);
});

test("every map marker is a served city from seo-content, with matching region", () => {
  const byName = new Map(CITIES.map((c) => [c.name, c.region]));
  for (const city of SERVICE_CITIES) {
    expect(byName.has(city.name)).toBe(true);
    expect(byName.get(city.name)).toBe(city.region);
  }
});

test("both metros are represented on the coverage map", () => {
  const regions = new Set(SERVICE_CITIES.map((c) => c.region));
  expect(regions.has("oc")).toBe(true);
  expect(regions.has("sj")).toBe(true);
});

test("marker coords are valid CA-range lat/lng tuples", () => {
  for (const { name, coords } of SERVICE_CITIES) {
    const [lat, lng] = coords;
    expect(lat).toBeGreaterThan(32);
    expect(lat).toBeLessThan(39);
    expect(lng).toBeGreaterThan(-123.5);
    expect(lng).toBeLessThan(-117);
    expect(name.length).toBeGreaterThan(0);
  }
});

test("boundsForView returns only that region's coords, and 'all' returns every marker", () => {
  expect(boundsForView("all").length).toBe(SERVICE_CITIES.length);
  const sj = boundsForView("sj");
  const oc = boundsForView("oc");
  expect(sj.length + oc.length).toBe(SERVICE_CITIES.length);
  expect(sj.length).toBeGreaterThan(0);
  expect(oc.length).toBeGreaterThan(0);
  // Every SJ bound sits north of every OC bound (sanity on the split).
  const minSjLat = Math.min(...sj.map(([lat]) => lat));
  const maxOcLat = Math.max(...oc.map(([lat]) => lat));
  expect(minSjLat).toBeGreaterThan(maxOcLat);
});

test("nearestRegion picks the closer metro for in-state visitors", () => {
  expect(nearestRegion(37.3382, -121.8863)).toBe("sj"); // San Jose
  expect(nearestRegion(37.7749, -122.4194)).toBe("sj"); // San Francisco
  expect(nearestRegion(33.6846, -117.8265)).toBe("oc"); // Irvine
  expect(nearestRegion(32.7157, -117.1611)).toBe("oc"); // San Diego
});

test("nearestRegion returns null for far-away visitors (overview fallback)", () => {
  expect(nearestRegion(40.7128, -74.006)).toBeNull(); // New York
  expect(nearestRegion(35.6762, 139.6503)).toBeNull(); // Tokyo
});
