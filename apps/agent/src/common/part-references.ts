import type { PartReference } from "@hmls/shared/db/schema";

/** Normalize untrusted tool arguments before persisting them in order JSON. */
export function normalizePartReferences(
  references: readonly PartReference[] | undefined,
): PartReference[] | undefined {
  if (!Array.isArray(references)) return undefined;

  const seen = new Set<string>();
  const normalized: PartReference[] = [];
  for (const reference of references) {
    if (!reference || typeof reference !== "object") continue;
    const partName = typeof reference.partName === "string" ? reference.partName.trim() : "";
    const brand = typeof reference.brand === "string" ? reference.brand.trim() : "";
    const partNumber = typeof reference.partNumber === "string" ? reference.partNumber.trim() : "";
    if (!partName || !brand || !partNumber || reference.source !== "rockauto") continue;

    const key = `${reference.source}\u0000${brand.toLowerCase()}\u0000${partNumber.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const oemPartNumber = typeof reference.oemPartNumber === "string"
      ? reference.oemPartNumber.trim()
      : "";
    normalized.push({
      partName,
      brand,
      partNumber,
      source: reference.source,
      ...(oemPartNumber ? { oemPartNumber } : {}),
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}
