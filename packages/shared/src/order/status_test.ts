import { assertEquals } from "@std/assert";
import { completionMissingDiagnosis } from "./status.ts";

Deno.test("completionMissingDiagnosis — blocks completion when diagnosis is empty/blank", () => {
  assertEquals(completionMissingDiagnosis("completed", ""), true);
  assertEquals(completionMissingDiagnosis("completed", "   "), true);
  assertEquals(completionMissingDiagnosis("completed", null), true);
  assertEquals(completionMissingDiagnosis("completed", undefined), true);
});

Deno.test("completionMissingDiagnosis — allows completion when diagnosis present", () => {
  assertEquals(completionMissingDiagnosis("completed", "worn front pads"), false);
  assertEquals(completionMissingDiagnosis("completed", "  rotors warped  "), false);
});

Deno.test("completionMissingDiagnosis — only gates completion, never other transitions", () => {
  assertEquals(completionMissingDiagnosis("in_progress", ""), false);
  assertEquals(completionMissingDiagnosis("cancelled", ""), false);
  assertEquals(completionMissingDiagnosis("scheduled", null), false);
});
