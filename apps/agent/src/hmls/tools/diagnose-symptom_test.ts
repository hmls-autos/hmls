import { assert, assertEquals } from "@std/assert";
import { shapeDiagnosis } from "./diagnose-symptom.ts";
import type { StructuredDiagnosis } from "../../fixo/diagnose-structured.ts";

const D: StructuredDiagnosis = {
  candidate_systems: [{ system: "brakes", confidence: 3, reasons: ["grinding"] }],
  likely_root_cause: "worn pads + scored rotor",
  recommended_tests: ["measure pad thickness"],
  safety_flags: ["Grinding can mean metal-on-metal — advise caution braking."],
  to_confirm: ["Front, rear, or both?"],
  narrative: "Front brake wear.",
};

Deno.test("shapeDiagnosis — null → available:false, no prediction id", () => {
  const out = shapeDiagnosis(null);
  assertEquals(out, { available: false });
  assert(!("predictionId" in out) && !("prediction_id" in out));
});

Deno.test("shapeDiagnosis — curated shape, internalScope present, no prediction id", () => {
  const out = shapeDiagnosis(D);
  assert(out.available === true);
  assertEquals(out.toConfirm, ["Front, rear, or both?"]);
  assertEquals(out.safetyFlags, D.safety_flags);
  assertEquals(out.internalScope.candidateSystems, D.candidate_systems);
  assertEquals(out.internalScope.recommendedTests, D.recommended_tests);
  assertEquals(out.internalScope.likelyRootCause, "worn pads + scored rotor");
  assert(!("predictionId" in out) && !("prediction_id" in out));
});

Deno.test("shapeDiagnosis — missing likely_root_cause → null", () => {
  const out = shapeDiagnosis({ ...D, likely_root_cause: undefined });
  assert(out.available === true);
  assertEquals(out.internalScope.likelyRootCause, null);
});
