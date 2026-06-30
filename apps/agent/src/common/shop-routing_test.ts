import { assertEquals } from "@std/assert";
import { nearestShop, parseGeocodeResponse, routingReviewNote } from "./shop-routing.ts";

const SJ = { id: "sj", latitude: "37.3361663", longitude: "-121.890591", serviceRadiusKm: null };
const OC = { id: "oc", latitude: "33.6484505", longitude: "-117.8365716", serviceRadiusKm: null };

Deno.test("nearestShop: a Bay Area point picks San Jose", () => {
  assertEquals(nearestShop({ lat: 37.3688, lng: -122.0363 }, [SJ, OC]), "sj");
});

Deno.test("nearestShop: a SoCal point picks Orange County", () => {
  assertEquals(nearestShop({ lat: 33.7455, lng: -117.8677 }, [SJ, OC]), "oc");
});

Deno.test("nearestShop: outside every radius => null", () => {
  const capped = [{ ...SJ, serviceRadiusKm: 50 }, { ...OC, serviceRadiusKm: 50 }];
  assertEquals(nearestShop({ lat: 40.0, lng: -100.0 }, capped), null);
});

Deno.test("parseGeocodeResponse: extracts lat/lng from a Census match (x=lng, y=lat)", () => {
  const body = { result: { addressMatches: [{ coordinates: { x: -121.2, y: 37.1 } }] } };
  assertEquals(parseGeocodeResponse(body), { lat: 37.1, lng: -121.2 });
});

Deno.test("parseGeocodeResponse: no matches => null", () => {
  assertEquals(parseGeocodeResponse({ result: { addressMatches: [] } }), null);
});

Deno.test("routingReviewNote: null when the order auto-routed", () => {
  assertEquals(routingReviewNote({ autoRouted: true, coords: { lat: 37, lng: -121 } }), null);
});

Deno.test("routingReviewNote: out-of-range note when coords resolved but no shop matched", () => {
  const note = routingReviewNote({ autoRouted: false, coords: { lat: 0, lng: 0 } });
  assertEquals(typeof note, "string");
  assertEquals(note!.includes("service radius"), true);
});

Deno.test("routingReviewNote: geocode-fail note when coords are null", () => {
  const note = routingReviewNote({ autoRouted: false, coords: null });
  assertEquals(typeof note, "string");
  assertEquals(note!.includes("geocode"), true);
});
