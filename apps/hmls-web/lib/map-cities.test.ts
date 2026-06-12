import { expect, test } from "bun:test";
import { SERVICE_CITIES } from "./map-cities";
import { CITIES } from "./seo-content";

test("marker list is non-empty (empty bounds would crash leaflet fitBounds)", () => {
  expect(SERVICE_CITIES.length).toBeGreaterThan(0);
});

test("every map marker is a served city from seo-content", () => {
  const served = new Set(CITIES.map((c) => c.name));
  for (const city of SERVICE_CITIES) {
    expect(served.has(city.name)).toBe(true);
  }
});

test("both metros are represented on the coverage map", () => {
  const regionOf = new Map(CITIES.map((c) => [c.name, c.region]));
  const regions = new Set(SERVICE_CITIES.map((c) => regionOf.get(c.name)));
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
