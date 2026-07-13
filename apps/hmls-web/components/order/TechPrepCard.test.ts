import { describe, expect, it } from "bun:test";
import type { OrderItem, PartReference } from "@hmls/shared/db/schema";
import { collectReferenceParts } from "./TechPrepCard";

function item(referenceParts?: PartReference[]): OrderItem {
  return {
    id: "service-1",
    category: "labor",
    name: "Spark Plug Replacement",
    quantity: 1,
    unitPriceCents: 10000,
    totalCents: 10000,
    taxable: true,
    referenceParts,
  };
}

describe("collectReferenceParts", () => {
  it("returns no references for absent data", () => {
    expect(collectReferenceParts([item()])).toEqual([]);
  });

  it("collects an aftermarket reference and its related service", () => {
    expect(
      collectReferenceParts([
        item([
          {
            partName: "Spark plug",
            brand: "NGK",
            partNumber: "6619",
            source: "rockauto",
          },
        ]),
      ]),
    ).toEqual([
      {
        serviceId: "service-1",
        serviceName: "Spark Plug Replacement",
        partName: "Spark plug",
        brand: "NGK",
        partNumber: "6619",
        source: "rockauto",
      },
    ]);
  });

  it("preserves an explicit OEM cross-reference", () => {
    const [reference] = collectReferenceParts([
      item([
        {
          partName: "Spark plug",
          brand: "NGK",
          partNumber: "6619",
          source: "rockauto",
          oemPartNumber: "12290-R40-A02",
        },
      ]),
    ]);
    expect(reference.oemPartNumber).toBe("12290-R40-A02");
  });

  it("drops malformed values and de-duplicates within the same service", () => {
    const duplicate = {
      partName: "Spark plug",
      brand: "NGK",
      partNumber: "6619",
      source: "rockauto" as const,
    };
    const malformed = {
      partName: 123,
      brand: "",
      partNumber: "bad",
      source: "rockauto" as const,
    } as unknown as PartReference;

    expect(
      collectReferenceParts([
        item([duplicate, { ...duplicate, brand: "ngk" }, malformed]),
      ]),
    ).toHaveLength(1);
  });
});
