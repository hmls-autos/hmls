import { describe, expect, test } from "bun:test";
import { roleHomePath, safeNextPath } from "./auth-redirect";

describe("safeNextPath", () => {
  test("accepts same-origin relative paths, with query strings", () => {
    expect(safeNextPath("/portal/orders")).toBe("/portal/orders");
    expect(safeNextPath("/admin/orders?status=active&today=1")).toBe(
      "/admin/orders?status=active&today=1",
    );
  });

  test("rejects absolute and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
  });

  test("rejects control-character strip-then-reparse bypasses", () => {
    // new URL("/\t/evil.example", origin).href === "https://evil.example/"
    expect(safeNextPath("/\t/evil.example")).toBeNull();
    expect(safeNextPath("/\n/evil.example")).toBeNull();
    expect(safeNextPath("/\r/evil.example")).toBeNull();
    expect(safeNextPath("/\t\\evil.example")).toBeNull();
  });

  test("rejects empty, missing, and login loops", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login?next=%2Fportal")).toBeNull();
  });
});

describe("roleHomePath", () => {
  test("routes staff to their sections, customers to chat", () => {
    expect(roleHomePath({ isAdmin: true, isMechanic: false })).toBe("/admin");
    expect(roleHomePath({ isAdmin: false, isMechanic: true })).toBe(
      "/mechanic",
    );
    expect(roleHomePath({ isAdmin: false, isMechanic: false })).toBe("/chat");
  });
});
