import { assertEquals } from "@std/assert";
import type { PartReference } from "@hmls/shared/db/schema";
import { normalizePartReferences } from "../part-references.ts";

Deno.test("normalizePartReferences trims values and preserves an explicit OEM number", () => {
  assertEquals(
    normalizePartReferences([
      {
        partName: " spark plug ",
        brand: " NGK ",
        partNumber: " 6619 ",
        source: "rockauto",
        oemPartNumber: " 12290-R40-A02 ",
      },
    ]),
    [
      {
        partName: "spark plug",
        brand: "NGK",
        partNumber: "6619",
        source: "rockauto",
        oemPartNumber: "12290-R40-A02",
      },
    ],
  );
});

Deno.test("normalizePartReferences drops empty values and de-duplicates case-insensitively", () => {
  const references: PartReference[] = [
    {
      partName: "spark plug",
      brand: "NGK",
      partNumber: "6619",
      source: "rockauto",
    },
    {
      partName: "duplicate label",
      brand: "ngk",
      partNumber: "6619",
      source: "rockauto",
    },
    {
      partName: "spark plug",
      brand: " ",
      partNumber: "bad",
      source: "rockauto",
    },
  ];

  assertEquals(normalizePartReferences(references), [references[0]]);
  assertEquals(
    normalizePartReferences([
      {
        partName: 123,
        brand: "NGK",
        partNumber: "bad",
        source: "rockauto",
      } as unknown as PartReference,
    ]),
    undefined,
  );
  assertEquals(normalizePartReferences([]), undefined);
  assertEquals(normalizePartReferences(undefined), undefined);
});
