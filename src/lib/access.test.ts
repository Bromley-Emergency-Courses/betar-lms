import { describe, expect, it } from "vitest";
import { can, visibleNavigationForRole } from "@/lib/access";

describe("role permissions", () => {
  it("allows admins to manage all protected areas", () => {
    expect(can("admin", "manage_finance")).toBe(true);
    expect(can("admin", "use_reception")).toBe(true);
  });

  it("allows teachers to view students and record teaching only", () => {
    expect(can("teacher", "view_students")).toBe(true);
    expect(can("teacher", "record_teaching")).toBe(true);
    expect(can("teacher", "manage_finance")).toBe(false);
  });

  it("limits reception to check-in navigation", () => {
    expect(can("reception", "use_reception")).toBe(true);
    expect(can("reception", "view_students")).toBe(false);
    expect(visibleNavigationForRole("reception")).toEqual(["Reception"]);
  });
});
