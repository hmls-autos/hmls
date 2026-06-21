import { assert } from "@std/assert";
import { newPredictionId } from "./brain-service.ts";

Deno.test("newPredictionId — pred_ prefixed uuid", () => {
  assert(/^pred_[0-9a-f-]{36}$/.test(newPredictionId()));
});
