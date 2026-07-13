"use client";

import type { OrderItem, PartReference } from "@hmls/shared/db/schema";
import type { Order } from "@hmls/shared/db/types";
import { AlertTriangle, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type TechPrep = NonNullable<OrderItem["techPrep"]>;
type DisplayPartReference = PartReference & {
  serviceId: string;
  serviceName: string;
};

const DIFFICULTY_LABEL = [
  "",
  "Routine",
  "Easy",
  "Moderate",
  "Hard",
  "Specialist",
];

/** Collect defensively from JSON-backed order items and de-dupe within a service. */
export function collectReferenceParts(
  items: readonly OrderItem[],
): DisplayPartReference[] {
  const collected: DisplayPartReference[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!Array.isArray(item.referenceParts)) continue;
    for (const raw of item.referenceParts) {
      if (!raw || typeof raw !== "object") continue;
      const partName =
        typeof raw.partName === "string" ? raw.partName.trim() : "";
      const brand = typeof raw.brand === "string" ? raw.brand.trim() : "";
      const partNumber =
        typeof raw.partNumber === "string" ? raw.partNumber.trim() : "";
      if (!partName || !brand || !partNumber || raw.source !== "rockauto")
        continue;

      const key = `${item.id}\u0000${raw.source}\u0000${brand.toLowerCase()}\u0000${partNumber.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const oemPartNumber =
        typeof raw.oemPartNumber === "string" ? raw.oemPartNumber.trim() : "";
      collected.push({
        serviceId: item.id,
        serviceName: item.name,
        partName,
        brand,
        partNumber,
        source: raw.source,
        ...(oemPartNumber ? { oemPartNumber } : {}),
      });
    }
  }

  return collected;
}

/**
 * Internal "Tech prep" panel for the shop's dispatcher / assigned mobile tech.
 * Surfaces the repair_jobs enrichment (tools, difficulty, HV-safety, notes)
 * and saved catalog references attached to each labor line at create_order
 * time. Renders nothing when neither kind of internal prep data is present.
 */
export function TechPrepCard({ order }: { order: Order }) {
  const items = order.items ?? [];
  const jobs = items
    .map((it) =>
      it.techPrep ? { item: it, tp: it.techPrep as TechPrep } : null,
    )
    .filter((x): x is { item: OrderItem; tp: TechPrep } => x !== null);
  const referenceParts = collectReferenceParts(items);

  if (jobs.length === 0 && referenceParts.length === 0) return null;

  const maxDifficulty =
    jobs.length > 0 ? Math.max(...jobs.map((j) => j.tp.difficulty)) : null;
  const hvRequired = jobs.some((j) => j.tp.hvSafety);

  // Consolidated, de-duped tools to bring; specialty tools sort first + starred.
  const toolMap = new Map<string, boolean>();
  for (const j of jobs) {
    for (const t of j.tp.tools) {
      toolMap.set(t.name, (toolMap.get(t.name) ?? false) || !!t.specialty);
    }
  }
  const tools = [...toolMap.entries()].sort(
    (a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]),
  );

  return (
    <Card className="gap-0 py-0 border-0">
      <CardHeader className="px-4 py-4 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5" /> Tech prep
        </CardTitle>
        <div className="flex items-center gap-1.5">
          {maxDifficulty !== null && (
            <Badge variant="secondary" className="text-[10px]">
              Difficulty {maxDifficulty}/5 · {DIFFICULTY_LABEL[maxDifficulty]}
            </Badge>
          )}
          {hvRequired && (
            <Badge
              variant="destructive"
              className="text-[10px] flex items-center gap-1"
            >
              <AlertTriangle className="w-3 h-3" /> HV-certified tech
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 text-xs space-y-3">
        {/* Tools to bring */}
        {jobs.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Tools to bring
            </p>
            <div className="flex flex-wrap gap-1.5">
              {tools.map(([name, specialty]) => (
                <span
                  key={name}
                  className={cn(
                    "px-1.5 py-0.5 rounded border text-[11px]",
                    specialty
                      ? "border-foreground/40 text-foreground font-medium"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {specialty ? "★ " : ""}
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Per-job detail */}
        {jobs.length > 0 && (
          <div className="space-y-1.5">
            {jobs.map((j) => (
              <div key={j.item.id} className="border-t border-border pt-1.5">
                <div className="flex justify-between gap-2">
                  <span className="text-foreground">{j.item.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    Diff {j.tp.difficulty}/5
                  </span>
                </div>
                {j.tp.notes && (
                  <p className="text-muted-foreground mt-0.5">{j.tp.notes}</p>
                )}
                {j.tp.likelySizes && j.tp.likelySizes.length > 0 && (
                  <p className="text-muted-foreground mt-0.5">
                    Sizes: {j.tp.likelySizes.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {referenceParts.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
              Reference part numbers
            </p>
            <div className="space-y-2">
              {referenceParts.map((reference) => (
                <div
                  key={`${reference.serviceId}-${reference.brand}-${reference.partNumber}`}
                  className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-foreground">{reference.partName}</p>
                    {reference.serviceName !== reference.partName && (
                      <p className="text-[10px] text-muted-foreground">
                        {reference.serviceName}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 sm:text-right">
                    <p className="font-mono text-[11px] text-foreground">
                      {reference.brand} {reference.partNumber}
                    </p>
                    {reference.oemPartNumber && (
                      <p className="font-mono text-[10px] text-muted-foreground">
                        OEM {reference.oemPartNumber}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          ★ specialty tool · internal only · AI-estimated, verify on site
          {referenceParts.length > 0 &&
            " · verify part fitment by VIN/engine before purchase"}
        </p>
      </CardContent>
    </Card>
  );
}
