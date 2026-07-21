// DB-only half of the Fixo brain (contract: brain-service.ts): mint/stamp
// fixo_predictions rows without ever touching the diagnosis agent.
//
// Split out of fixo-brain.ts so the HMLS Worker graph (create_order +
// gateway order routes) can record calibration telemetry WITHOUT dragging in
// diagnoseStructured → fixo agent → ffmpeg (blocker #8 in
// docs/cloudflare-migration.md). fixo-brain.ts re-exports these for the
// fixo-side callers; nothing here may import the agent.

import { eq } from "drizzle-orm";
import { getLogger } from "@logtape/logtape";
import { dbAdmin, schema } from "../db/client.ts";
import {
  type BrainService,
  type DiagnoseRequest,
  newPredictionId,
  type OutcomeRequest,
} from "./brain-service.ts";

const logger = getLogger(["hmls", "agent", "fixo-brain"]);

/** Cheap, synchronous-ish: mint a prediction id + insert the prediction row
 *  WITHOUT running the agent. For the create_order hot path — fill
 *  predicted_diagnosis async after via fillPrediction.
 *
 *  Uses dbAdmin (NOT the ALS-scoped db) so the insert commits immediately on
 *  its own connection, decoupled from create_order's still-open outer tenant
 *  transaction. Otherwise the row is invisible to the detached fillPrediction /
 *  recordEstimate writes (which run on dbAdmin, a separate connection) and they
 *  update 0 rows. fixo_predictions is a non-RLS'd system table so admin is
 *  correct; an orphan row if the order later rolls back is a harmless
 *  calibration artifact.
 *
 *  ponytail: if a worker/queue ever exists, move fillPrediction there; for now
 *  a detached promise is fine since Deno Deploy doesn't kill the isolate mid-request. */
export async function openPrediction(req: DiagnoseRequest, apiKeyId?: string): Promise<string> {
  const predictionId = newPredictionId();
  await dbAdmin.insert(schema.fixoPredictions).values({
    id: predictionId,
    vehicleInfo: req.vehicle,
    symptom: req.symptom,
    dtcs: req.dtcs ?? null,
    predictedDiagnosis: null,
    apiKeyId: apiKeyId ?? null,
  });
  return predictionId;
}

/** Close the loop: stamp the mechanic's confirmed outcome onto the prediction
 *  row by predictionId. Idempotent — re-recording overwrites. Never throws
 *  (callers fire-and-forget on the order-save path); a missing prediction row
 *  is logged, not raised, so a stale/wrong id can't be silently swallowed.
 *
 *  callerKeyId: when set (external MCP path), ownership is enforced — a
 *  prediction opened by a different key OR with no owner at all (NULL apiKeyId,
 *  i.e. an internal create_order prediction) is rejected (logged + no write),
 *  so an external caller holding a UUID can't overwrite internal predictions.
 *  The internal path (no callerKeyId) keeps its ability to write NULL-owner rows.
 *
 *  Uses dbAdmin: called fire-and-forget from PATCH /orders/:id after that
 *  request's tenant-scoped transaction has already committed, so the
 *  ALS-inherited executor would be a closed tx — dbAdmin always opens its own
 *  connection and fixo_predictions is a non-RLS'd system table, so bypass is
 *  correct here. */
export async function recordOutcome(req: OutcomeRequest, callerKeyId?: string): Promise<void> {
  // Ownership check: fetch the prediction's apiKeyId before writing.
  const rows = await dbAdmin
    .select({ apiKeyId: schema.fixoPredictions.apiKeyId })
    .from(schema.fixoPredictions)
    .where(eq(schema.fixoPredictions.id, req.predictionId));

  if (rows.length > 0) {
    const ownerKeyId = rows[0].apiKeyId ?? null;
    // Owned row: only its owning key may write. NULL-owner (internal) row: any
    // external caller (callerKeyId set) is rejected; the internal path (no
    // callerKeyId) may still write it.
    const rejected = ownerKeyId !== null ? ownerKeyId !== callerKeyId : callerKeyId != null;
    if (rejected) {
      logger.warn("record_outcome ownership mismatch", {
        predictionId: req.predictionId,
        ownerKeyId,
        callerKeyId,
      });
      return;
    }
  }

  const updated = await dbAdmin
    .update(schema.fixoPredictions)
    .set({
      confirmedDiagnosis: req.confirmedDiagnosis,
      actualCostCents: req.actualCostCents ?? null,
      outcomeAt: new Date(),
    })
    .where(eq(schema.fixoPredictions.id, req.predictionId))
    .returning({ id: schema.fixoPredictions.id });

  if (updated.length === 0) {
    logger.warn("recordOutcome: no prediction row matched", {
      predictionId: req.predictionId,
    });
  }
}

/** Attach the priced estimate to a prediction row for estimate-vs-actual
 *  calibration. Pricing is the shared OLP engine (skills/estimate/pricing.ts);
 *  this only records the result. Idempotent; logs (never throws) on a missing
 *  row, same as recordOutcome.
 *
 *  Uses dbAdmin: called fire-and-forget from create_order while that tool's
 *  outer tenant-scoped transaction may still be open, so the ALS-inherited
 *  executor isn't usable — dbAdmin opens its own connection and sees the row
 *  because openPrediction committed it via dbAdmin too. fixo_predictions is a
 *  non-RLS'd system table, so admin is correct here. */
export const recordEstimate: BrainService["recordEstimate"] = async (req) => {
  const { predictionId, ...estimate } = req;
  const updated = await dbAdmin
    .update(schema.fixoPredictions)
    .set({ predictedEstimate: estimate })
    .where(eq(schema.fixoPredictions.id, predictionId))
    .returning({ id: schema.fixoPredictions.id });

  if (updated.length === 0) {
    logger.warn("recordEstimate: no prediction row matched", { predictionId });
  }
};
