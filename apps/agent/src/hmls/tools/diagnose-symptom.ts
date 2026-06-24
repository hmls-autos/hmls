import { z } from "zod";
import { toolResult } from "@hmls/shared/tool-result";
import { diagnose } from "../../common/fixo-diagnose.ts";
import type { StructuredDiagnosis } from "../../fixo/diagnose-structured.ts";
import type { LegacyTool } from "../../common/convert-tools.ts";

/** Pure: curate a StructuredDiagnosis into the agent-facing result. SHOP-ONLY
 *  fields live under internalScope; there is intentionally NO prediction id
 *  (this path is non-persisting; create_order owns the persisted prediction). */
export function shapeDiagnosis(d: StructuredDiagnosis | null) {
  if (!d) return { available: false as const };
  return {
    available: true as const,
    toConfirm: d.to_confirm,
    safetyFlags: d.safety_flags,
    internalScope: {
      candidateSystems: d.candidate_systems,
      recommendedTests: d.recommended_tests,
      likelyRootCause: d.likely_root_cause ?? null,
    },
  };
}

const diagnoseSymptomTool: LegacyTool = {
  name: "diagnose_symptom",
  description:
    "Run the repair-diagnosis brain on a vehicle + symptom BEFORE the labor/parts lookups and " +
    "create_order. Use for repair/diagnostic cases (noise, warning light, leak, anything wrong) — " +
    "NOT routine maintenance (oil change, rotation, filter). Returns: toConfirm (follow-up " +
    "questions to ask the customer), safetyFlags (you MAY relay these as a plain caution), and " +
    "internalScope (candidate systems, recommended tests, likely root cause). internalScope is " +
    "SHOP-ONLY: use it to choose/scope services, but NEVER recite candidate systems or the likely " +
    "root cause to the customer. If available is false, just continue intake normally.",
  schema: z.object({
    vehicle: z.object({
      year: z.union([z.number(), z.string()]).optional(),
      make: z.string().optional(),
      model: z.string().optional(),
    }),
    symptom: z.string().min(1),
    dtcs: z.array(z.string()).optional().describe("OBD codes if the customer read them (rare)."),
  }),
  execute: async (
    params: {
      vehicle: { year?: number | string; make?: string; model?: string };
      symptom: string;
      dtcs?: string[];
    },
  ) => {
    const d = await diagnose({
      vehicle: params.vehicle,
      symptom: params.symptom,
      dtcs: params.dtcs,
    });
    return toolResult({ success: true, ...shapeDiagnosis(d) });
  },
};

export const diagnoseSymptomTools: LegacyTool[] = [diagnoseSymptomTool];
