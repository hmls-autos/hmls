import { describe, expect, it } from "bun:test";
import { buildContactMessage } from "./ContactIntakeCard";

// Regression: the submit message is a contract with the agent — it re-extracts
// phone/address/preference from this text and relays the preference token
// verbatim into create_order's z.enum(["text","call","email"]).
describe("buildContactMessage", () => {
  const base = {
    phone: "4085551234",
    address: "713 Modern Ice Dr",
    access: "",
  };

  it("formats phone and address without optional fields", () => {
    expect(buildContactMessage({ ...base, preferred: null })).toBe(
      "Contact phone: 4085551234. Service address: 713 Modern Ice Dr.",
    );
  });

  it("appends the exact lowercase preferred-contact token", () => {
    expect(buildContactMessage({ ...base, preferred: "text" })).toBe(
      "Contact phone: 4085551234. Service address: 713 Modern Ice Dr. Preferred contact: text.",
    );
    expect(buildContactMessage({ ...base, preferred: "call" })).toContain(
      "Preferred contact: call.",
    );
    expect(buildContactMessage({ ...base, preferred: "email" })).toContain(
      "Preferred contact: email.",
    );
  });

  it("omits the preference part when none selected", () => {
    expect(buildContactMessage({ ...base, preferred: null })).not.toContain(
      "Preferred contact",
    );
  });

  it("includes access notes only when non-empty", () => {
    expect(
      buildContactMessage({ ...base, access: "gate 1234", preferred: "text" }),
    ).toBe(
      "Contact phone: 4085551234. Service address: 713 Modern Ice Dr. Access notes: gate 1234. Preferred contact: text.",
    );
    expect(
      buildContactMessage({ ...base, access: "   ", preferred: null }),
    ).not.toContain("Access notes");
  });

  it("trims whitespace from all fields", () => {
    expect(
      buildContactMessage({
        phone: " 4085551234 ",
        address: " 713 Modern Ice Dr ",
        access: " gate 1234 ",
        preferred: "text",
      }),
    ).toBe(
      "Contact phone: 4085551234. Service address: 713 Modern Ice Dr. Access notes: gate 1234. Preferred contact: text.",
    );
  });
});
