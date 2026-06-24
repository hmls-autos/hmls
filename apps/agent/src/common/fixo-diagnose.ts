import { diagnoseStructured, type StructuredDiagnosis } from "../fixo/diagnose-structured.ts";
import type { DiagnoseOnceInput } from "../fixo/run-once-prompt.ts";

export interface DiagnoseInput {
  vehicle: { year?: number | string; make?: string; model?: string };
  symptom: string;
  dtcs?: string[];
  /** Reserved for the vision fast-follow; ignored in v1 (maps to DiagnoseRequest.photoUrls later). */
  imageRefs?: string[];
}

/**
 * Contract-decoupled client for the Fixo brain. v1 transport = the in-process,
 * NON-persisting diagnoseStructured (no fixo_predictions row). To externalize,
 * replace ONLY the default `run` with an HTTP /v1/mcp diagnose call.
 *
 * Best-effort: returns null on any thrown failure (brain/DB) — never throws.
 * A degraded empty-candidate diagnosis is a NON-null success; callers treat an
 * empty to_confirm as "no useful follow-ups", not an error.
 */
export async function diagnose(
  input: DiagnoseInput,
  run: (i: DiagnoseOnceInput) => Promise<StructuredDiagnosis> = diagnoseStructured,
): Promise<StructuredDiagnosis | null> {
  try {
    // imageRefs intentionally dropped in v1 (DiagnoseOnceInput has no image field).
    return await run({
      vehicle: {
        year: input.vehicle.year ?? "",
        make: input.vehicle.make ?? "",
        model: input.vehicle.model ?? "",
      },
      symptom: input.symptom,
      dtcs: input.dtcs,
    });
  } catch (err) {
    console.error("diagnose() failed:", String(err));
    return null;
  }
}
