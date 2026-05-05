import { describe, expect, test } from "bun:test";
import {
  getAdminOrderDetailHref,
  getAdminOrdersListHref,
  parseAdminOrdersFilter,
} from "./admin-order-filters";

describe("admin order filter URL helpers", () => {
  test("parses only supported order status filters", () => {
    expect(parseAdminOrdersFilter("draft")).toBe("draft");
    expect(parseAdminOrdersFilter("in_progress")).toBe("in_progress");
    expect(parseAdminOrdersFilter("cancelled")).toBe("cancelled");
    expect(parseAdminOrdersFilter(null)).toBe("");
    expect(parseAdminOrdersFilter("unknown")).toBe("");
  });

  test("builds list hrefs with filter state in the URL", () => {
    expect(getAdminOrdersListHref("")).toBe("/admin/orders");
    expect(getAdminOrdersListHref("draft")).toBe("/admin/orders?status=draft");
    expect(getAdminOrdersListHref("in_progress")).toBe(
      "/admin/orders?status=in_progress",
    );
  });

  test("carries the active filter into order detail links", () => {
    expect(getAdminOrderDetailHref(380, "")).toBe("/admin/orders/380");
    expect(getAdminOrderDetailHref(380, "draft")).toBe(
      "/admin/orders/380?fromStatus=draft",
    );
    expect(getAdminOrderDetailHref(380, "cancelled")).toBe(
      "/admin/orders/380?fromStatus=cancelled",
    );
  });
});
