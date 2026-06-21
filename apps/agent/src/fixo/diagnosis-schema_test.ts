import { assertEquals } from "@std/assert";
import { structuredDiagnosisSchema } from "./diagnosis-schema.ts";

Deno.test("structuredDiagnosisSchema — accepts a full diagnosis", () => {
  const parsed = structuredDiagnosisSchema.parse({
    candidate_systems: [{ system: "brakes", confidence: 3, reasons: ["grinding + pulsation"] }],
    likely_root_cause: "worn front pads + warped rotors",
    recommended_tests: ["inspect pad thickness", "measure rotor runout"],
    safety_flags: ["increased stopping distance — avoid high speed"],
    to_confirm: ["ABS light on?", "sudden vs gradual?"],
    narrative: "Grinding + pedal pulsation point to front brakes.",
  });
  assertEquals(parsed.candidate_systems[0].system, "brakes");
});

Deno.test("structuredDiagnosisSchema — minimal (only required fields)", () => {
  const parsed = structuredDiagnosisSchema.parse({
    candidate_systems: [],
    recommended_tests: [],
    safety_flags: [],
    to_confirm: [],
    narrative: "Not enough info yet.",
  });
  assertEquals(parsed.likely_root_cause, undefined);
});
