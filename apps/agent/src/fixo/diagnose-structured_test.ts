import { assert } from "@std/assert";
import { buildStructuredDiagnosePrompt } from "./run-once-prompt.ts";

Deno.test("buildStructuredDiagnosePrompt — instructs emit_diagnosis + no questions", () => {
  const p = buildStructuredDiagnosePrompt({
    vehicle: { year: 2018, make: "Honda", model: "Civic" },
    symptom: "grinding when braking",
  });
  assert(p.includes("Honda"));
  assert(p.includes("emit_diagnosis"));
  assert(/do not ask|don't ask/i.test(p));
});
