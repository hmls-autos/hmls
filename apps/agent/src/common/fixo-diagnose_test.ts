import { assert, assertEquals } from "@std/assert";
import { diagnose } from "./fixo-diagnose.ts";
import type { StructuredDiagnosis } from "../fixo/diagnose-structured.ts";
import type { DiagnoseOnceInput } from "../fixo/run-once-prompt.ts";

const SAMPLE: StructuredDiagnosis = {
  candidate_systems: [{ system: "ignition", confidence: 3, reasons: ["P0300"] }],
  likely_root_cause: "worn spark plugs",
  recommended_tests: ["inspect plugs"],
  safety_flags: [],
  to_confirm: ["miles since last plug change?"],
  narrative: "misfire",
};

Deno.test("diagnose — maps input onto DiagnoseOnceInput, drops imageRefs", async () => {
  let seen: DiagnoseOnceInput | null = null;
  const out = await diagnose(
    {
      vehicle: { year: 2019, make: "Honda", model: "Accord" },
      symptom: "shakes",
      dtcs: ["P0300"],
      imageRefs: ["x"],
    },
    (i) => {
      seen = i;
      return Promise.resolve(SAMPLE);
    },
  );
  assertEquals(out, SAMPLE);
  assertEquals(seen!.symptom, "shakes");
  assertEquals(seen!.dtcs, ["P0300"]);
  assertEquals(seen!.vehicle.make, "Honda");
  assert(seen !== null);
  assert(!Object.hasOwn(seen, "imageRefs"));
});

Deno.test("diagnose — missing vehicle fields default to empty strings", async () => {
  let seen: DiagnoseOnceInput | null = null;
  await diagnose({ vehicle: {}, symptom: "x" }, (i) => {
    seen = i;
    return Promise.resolve(SAMPLE);
  });
  assertEquals(seen!.vehicle.make, "");
  assertEquals(seen!.vehicle.model, "");
  assertEquals(seen!.vehicle.year, "");
});

Deno.test("diagnose — returns null on a thrown error", async () => {
  const out = await diagnose({ vehicle: {}, symptom: "x" }, () => {
    throw new Error("boom");
  });
  assertEquals(out, null);
});

Deno.test("diagnose — a degraded empty-candidate diagnosis is non-null", async () => {
  const degraded: StructuredDiagnosis = {
    candidate_systems: [],
    recommended_tests: [],
    safety_flags: [],
    to_confirm: [],
    narrative: "",
  };
  const out = await diagnose({ vehicle: {}, symptom: "x" }, () => Promise.resolve(degraded));
  assert(out !== null);
  assertEquals(out!.candidate_systems.length, 0);
});
