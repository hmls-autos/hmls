import { structuredDiagnosisSchema } from "../diagnosis-schema.ts";

// A capture tool: the agent calls it ONCE with its final structured diagnosis.
// execute just echoes — diagnose-structured.ts reads the args off the stream.
export const emitDiagnosisTool = {
  name: "emit_diagnosis",
  description: "Call EXACTLY ONCE as your final action, with your complete structured diagnosis. " +
    "After calling it, stop. Do not ask the user anything.",
  schema: structuredDiagnosisSchema,
  // deno-lint-ignore no-explicit-any
  execute: (input: any) => input,
};
