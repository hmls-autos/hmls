// In-process implementation of the Fixo brain service (contract: brain-service.ts).
//
// Phase 0: HMLS imports and calls these directly (same Deno Deploy app). They
// take/return the plain serializable DTOs from brain-service.ts and write to
// fixo_predictions, so lifting behind HTTP later is a transport swap.
//
// This file holds ONLY the functions that run the diagnosis agent
// (diagnoseStructured → fixo agent). The DB-only telemetry half
// (openPrediction / recordOutcome / recordEstimate) lives in
// prediction-log.ts so the HMLS Worker graph can import it without dragging
// the agent in (blocker #8 in docs/cloudflare-migration.md).

import { getLogger } from "@logtape/logtape";
import { eq } from "drizzle-orm";
import { db, dbAdmin, schema } from "../db/client.ts";
import { diagnoseStructured } from "./diagnose-structured.ts";
import type { BrainService, DiagnoseRequest, DiagnoseResult } from "./brain-service.ts";
import { openPrediction, recordEstimate, recordOutcome } from "./prediction-log.ts";
import type { DiagnoseOnceInput } from "./run-once-prompt.ts";
import type { StructuredDiagnosis } from "./diagnosis-schema.ts";

// Fixo-side callers keep importing everything from fixo-brain; only the
// worker-graph callers import prediction-log directly.
export { openPrediction, recordEstimate, recordOutcome };

const logger = getLogger(["hmls", "agent", "fixo-brain"]);

/** Map DiagnoseRequest.vehicle (VehicleInfo — all fields optional) to the
 *  DiagnoseOnceInput.vehicle shape (year/make/model required). Fallback to
 *  empty string so the agent still gets a usable prompt. */
function toOnceVehicle(req: DiagnoseRequest): DiagnoseOnceInput["vehicle"] {
  if (!req.vehicle.make || !req.vehicle.model) {
    logger.warn("diagnose: incomplete vehicle info", { vehicle: req.vehicle });
  }
  return {
    year: req.vehicle.year ?? "",
    make: req.vehicle.make ?? "",
    model: req.vehicle.model ?? "",
  };
}

/** Fill an existing prediction row with the expert structured diagnosis.
 *  Called fire-and-forget from create_order so the ~5s agent run does not
 *  block order creation. Uses dbAdmin: this runs detached and create_order's
 *  outer tenant transaction may still be open, so the ALS-inherited executor
 *  isn't usable here — dbAdmin opens its own connection, and it can see the row
 *  because openPrediction committed it via dbAdmin too. fixo_predictions is a
 *  non-RLS'd system table, so admin is correct. */
export async function fillPrediction(predictionId: string, req: DiagnoseRequest): Promise<void> {
  const structured = await diagnoseStructured({
    vehicle: toOnceVehicle(req),
    symptom: req.symptom,
    dtcs: req.dtcs,
  });
  const updated = await dbAdmin
    .update(schema.fixoPredictions)
    .set({ predictedDiagnosis: structured })
    .where(eq(schema.fixoPredictions.id, predictionId))
    .returning({ id: schema.fixoPredictions.id });

  if (updated.length === 0) {
    logger.warn("fillPrediction: no prediction row matched", { predictionId });
  }
}

/** API path: mint a prediction id + run the full structured diagnosis + store it,
 *  returning BOTH the id (for record_outcome) and the full StructuredDiagnosis.
 *  Used by the MCP `diagnose` tool. */
export async function diagnoseForApi(
  req: DiagnoseRequest,
  apiKeyId?: string,
): Promise<{ predictionId: string; diagnosis: StructuredDiagnosis }> {
  const predictionId = await openPrediction(req, apiKeyId);
  const diagnosis = await diagnoseStructured({
    vehicle: toOnceVehicle(req),
    symptom: req.symptom,
    dtcs: req.dtcs,
  });
  await db
    .update(schema.fixoPredictions)
    .set({ predictedDiagnosis: diagnosis })
    .where(eq(schema.fixoPredictions.id, predictionId));
  return { predictionId, diagnosis };
}

/** Full expert path: open + fill + return the enriched DiagnoseResult.
 *  Use for direct API callers (POST /v1/diagnose) and tests — not for the
 *  create_order hot path (which uses openPrediction + void fillPrediction). */
export const diagnose: BrainService["diagnose"] = async (req) => {
  const predictionId = await openPrediction(req);
  const structured = await diagnoseStructured({
    vehicle: toOnceVehicle(req),
    symptom: req.symptom,
    dtcs: req.dtcs,
  });
  await db
    .update(schema.fixoPredictions)
    .set({ predictedDiagnosis: structured })
    .where(eq(schema.fixoPredictions.id, predictionId));
  return {
    predictionId,
    // confidence is number (0-3) in the schema; DiagnoseResult narrows to 0|1|2|3.
    // Zod enforces the 0-3 range at parse time, so the assertion is runtime-safe.
    candidateSystems: structured.candidate_systems as DiagnoseResult["candidateSystems"],
    rootCause: structured.likely_root_cause,
    tests: structured.recommended_tests,
  };
};

/** The assembled in-process brain. HMLS imports `brain` (or the individual
 *  functions) and calls it directly; Phase 2 wraps the same shape behind HTTP. */
export const brain: BrainService = { diagnose, recordEstimate, recordOutcome };
