import { assert, assertEquals } from "@std/assert";
import { formatResults, type PartResult } from "./parts-lookup.ts";

function part(
  tier: string,
  price: number,
  partNumber: string,
  brand = "ACME",
): PartResult {
  return {
    brand,
    partNumber,
    description: "",
    price,
    coreCharge: 0,
    tier,
  };
}

function recommended(results: PartResult[]) {
  const result = formatResults("2020 Honda Civic", "spark plug", results);
  assert(result.found);
  assert("recommendedPart" in result);
  return result;
}

Deno.test("formatResults selects the median premium option and ties its reference to price", () => {
  const result = recommended([
    part("Premium", 30, "PREM-30"),
    part("Premium", 10, "PREM-10"),
    part("Premium", 20, "PREM-20", "NGK"),
    part("Daily Driver", 12, "DAILY-12"),
  ]);

  assertEquals(result.recommendedPrice, 20);
  assertEquals(result.recommendedPart, {
    partName: "spark plug",
    source: "rockauto",
    brand: "NGK",
    partNumber: "PREM-20",
    price: 20,
    coreCharge: undefined,
    description: undefined,
  });
  assertEquals(result.recommendedTier, "Premium");
});

Deno.test("formatResults falls back to the median daily-driver option", () => {
  const result = recommended([
    part("Economy", 8, "ECO-8"),
    part("Standard", 18, "STD-18"),
    part("Daily Driver", 14, "DAILY-14"),
  ]);

  assertEquals(result.recommendedPrice, 18);
  assertEquals(result.recommendedPart.partNumber, "STD-18");
  assertEquals(result.recommendedTier, "Daily Driver");
});

Deno.test("formatResults falls back to the median economy option", () => {
  const result = recommended([
    part("Economy", 11, "ECO-11"),
    part("Economy", 7, "ECO-7"),
    part("Economy", 9, "ECO-9"),
  ]);

  assertEquals(result.recommendedPrice, 9);
  assertEquals(result.recommendedPart.partNumber, "ECO-9");
  assertEquals(result.recommendedTier, "Economy");
});

Deno.test("formatResults preserves the existing generic-tier fallback", () => {
  const result = recommended([
    part("Special", 25, "SPECIAL-25"),
    part("Special", 35, "SPECIAL-35"),
    part("Special", 45, "SPECIAL-45"),
  ]);

  assertEquals(result.recommendedPrice, 35);
  assertEquals(result.recommendedPart.partNumber, "SPECIAL-35");
});
