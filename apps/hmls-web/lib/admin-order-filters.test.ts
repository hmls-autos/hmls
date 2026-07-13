import { describe, expect, test } from "bun:test";
import {
  applyVirtualOrderFilters,
  getAdminOrderDetailHref,
  getAdminOrdersListHref,
  parseAdminOrdersFilter,
  parseAdminOrdersSearch,
  parseAdminOrdersToday,
} from "./admin-order-filters";

describe("admin order filter URL helpers", () => {
  test("parses only supported order status filters", () => {
    expect(parseAdminOrdersFilter("draft")).toBe("draft");
    expect(parseAdminOrdersFilter("in_progress")).toBe("in_progress");
    expect(parseAdminOrdersFilter("cancelled")).toBe("cancelled");
    expect(parseAdminOrdersFilter(null)).toBe("");
    expect(parseAdminOrdersFilter("unknown")).toBe("");
  });

  test("retired statuses from old bookmarks fall back to All", () => {
    // 9→7 collapse: scheduled/revised are no longer filterable states.
    expect(parseAdminOrdersFilter("scheduled")).toBe("");
    expect(parseAdminOrdersFilter("revised")).toBe("");
  });

  test("trims search input and treats blank as empty", () => {
    expect(parseAdminOrdersSearch(null)).toBe("");
    expect(parseAdminOrdersSearch("  ")).toBe("");
    expect(parseAdminOrdersSearch(" brake ")).toBe("brake");
  });

  test("builds list hrefs with filter state in the URL", () => {
    expect(getAdminOrdersListHref("")).toBe("/admin/orders");
    expect(getAdminOrdersListHref("draft")).toBe("/admin/orders?status=draft");
    expect(getAdminOrdersListHref("in_progress")).toBe(
      "/admin/orders?status=in_progress",
    );
  });

  test("merges filter and search into the list href", () => {
    expect(getAdminOrdersListHref("", "brake")).toBe(
      "/admin/orders?search=brake",
    );
    expect(getAdminOrdersListHref("draft", "brake noise")).toBe(
      "/admin/orders?status=draft&search=brake+noise",
    );
    expect(getAdminOrdersListHref("draft", "  ")).toBe(
      "/admin/orders?status=draft",
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

  test("carries filter and search into order detail links", () => {
    expect(getAdminOrderDetailHref(380, "draft", "brake")).toBe(
      "/admin/orders/380?fromStatus=draft&search=brake",
    );
    expect(getAdminOrderDetailHref(380, "", "brake")).toBe(
      "/admin/orders/380?search=brake",
    );
  });
});

describe("virtual filters", () => {
  const now = new Date("2026-07-12T15:00:00");
  const rows = [
    { id: 1, status: "approved", scheduledAt: "2026-07-12T09:00:00" },
    { id: 2, status: "approved", scheduledAt: "2026-07-13T09:00:00" },
    { id: 3, status: "in_progress", scheduledAt: null },
    { id: 4, status: "draft", scheduledAt: "2026-07-12T10:00:00" },
  ];

  test("'active' parses and unions approved + in_progress", () => {
    expect(parseAdminOrdersFilter("active")).toBe("active");
    expect(
      applyVirtualOrderFilters(rows, "active", false, now).map((r) => r.id),
    ).toEqual([1, 2, 3]);
  });

  test("today=1 keeps only rows scheduled within the local day", () => {
    expect(parseAdminOrdersToday("1")).toBe(true);
    expect(parseAdminOrdersToday(null)).toBe(false);
    expect(
      applyVirtualOrderFilters(rows, "active", true, now).map((r) => r.id),
    ).toEqual([1]);
  });

  test("plain status filters pass through untouched", () => {
    expect(applyVirtualOrderFilters(rows, "draft", false, now)).toHaveLength(4);
  });

  test("href builder carries today", () => {
    expect(getAdminOrdersListHref("active", undefined, { today: true })).toBe(
      "/admin/orders?status=active&today=1",
    );
  });
});
