import { describe, expect, it } from "bun:test";
import {
  logContactInput,
  updateOrderInput,
} from "@hmls/shared/api/contracts/orders";

// Trust-boundary pins for the preferred-contact gateway inputs.
describe("logContactInput", () => {
  it("accepts each contact method", () => {
    for (const method of ["text", "call", "email"]) {
      expect(logContactInput.safeParse({ method }).success).toBe(true);
    }
  });

  it("accepts an optional note", () => {
    expect(
      logContactInput.safeParse({ method: "call", note: "left voicemail" })
        .success,
    ).toBe(true);
  });

  it("rejects invalid or missing method", () => {
    expect(logContactInput.safeParse({ method: "sms" }).success).toBe(false);
    expect(logContactInput.safeParse({ method: "fax" }).success).toBe(false);
    expect(logContactInput.safeParse({}).success).toBe(false);
  });
});

describe("updateOrderInput.contact_preferred", () => {
  it("accepts enum values, null, and undefined", () => {
    expect(
      updateOrderInput.safeParse({ contact_preferred: "text" }).success,
    ).toBe(true);
    expect(
      updateOrderInput.safeParse({ contact_preferred: null }).success,
    ).toBe(true);
    expect(updateOrderInput.safeParse({}).success).toBe(true);
  });

  it("rejects non-enum strings", () => {
    expect(
      updateOrderInput.safeParse({ contact_preferred: "sms" }).success,
    ).toBe(false);
    expect(
      updateOrderInput.safeParse({ contact_preferred: "Text" }).success,
    ).toBe(false);
  });
});
