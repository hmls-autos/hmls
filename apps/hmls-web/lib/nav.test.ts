import { describe, expect, test } from "bun:test";
import { detectSection, mechanicNavItems, sectionNavItems } from "./nav";

const roles = (isAdmin: boolean, isMechanic: boolean) => ({
  isAdmin,
  isMechanic,
});

describe("detectSection", () => {
  test("portal paths are a section for any role", () => {
    expect(detectSection("/portal", roles(false, false))).toBe("portal");
    expect(detectSection("/portal/orders/5", roles(true, false))).toBe(
      "portal",
    );
  });

  test("admin paths are a section only for admins", () => {
    expect(detectSection("/admin/orders", roles(true, false))).toBe("admin");
    expect(detectSection("/admin/orders", roles(false, false))).toBeNull();
    expect(detectSection("/admin", roles(false, true))).toBeNull();
  });

  test("mechanic paths are a section only for mechanics (admins 403 there)", () => {
    expect(detectSection("/mechanic", roles(false, true))).toBe("mechanic");
    expect(detectSection("/mechanic/time-off", roles(true, false))).toBeNull();
  });

  test("marketing paths are no section", () => {
    expect(detectSection("/", roles(true, true))).toBeNull();
    expect(detectSection("/contact", roles(false, false))).toBeNull();
  });
});

describe("nav vocabulary", () => {
  test("mechanic home item is labeled My Jobs (page h1 parity)", () => {
    expect(mechanicNavItems[0]?.label).toBe("My Jobs");
  });

  test("sectionNavItems maps every section", () => {
    expect(Object.keys(sectionNavItems).sort()).toEqual([
      "admin",
      "mechanic",
      "portal",
    ]);
  });
});
