import { describe, expect, it } from "vitest";
import { portalSignInPath, routeAuthBoundaryForPath, safePortalNextPath } from "@/lib/portal-access";

describe("route auth boundaries", () => {
  it("keeps staff login and applicant routes public", () => {
    expect(routeAuthBoundaryForPath("/login")).toBe("public");
    expect(routeAuthBoundaryForPath("/login/reset")).toBe("public");
    expect(routeAuthBoundaryForPath("/apply")).toBe("public");
    expect(routeAuthBoundaryForPath("/apply/login")).toBe("public");
  });

  it("keeps applicant and student portal routes on the portal boundary", () => {
    expect(routeAuthBoundaryForPath("/portal")).toBe("portal");
    expect(routeAuthBoundaryForPath("/portal/modules/preferences")).toBe("portal");
    expect(routeAuthBoundaryForPath("/portal?tab=registration")).toBe("portal");
  });

  it("keeps existing LMS routes staff-only by default", () => {
    expect(routeAuthBoundaryForPath("/")).toBe("staff");
    expect(routeAuthBoundaryForPath("/students")).toBe("staff");
    expect(routeAuthBoundaryForPath("/admissions")).toBe("staff");
    expect(routeAuthBoundaryForPath("/api/students/student-id/photo")).toBe("staff");
  });

  it("preserves only safe portal next paths", () => {
    expect(safePortalNextPath("/portal")).toBe("/portal");
    expect(safePortalNextPath("/portal/registration")).toBe("/portal/registration");
    expect(safePortalNextPath("/portal?tab=registration")).toBe("/portal?tab=registration");
    expect(safePortalNextPath("/apply/login")).toBe("/apply/login");
    expect(safePortalNextPath("/students")).toBe("/portal");
    expect(safePortalNextPath("//example.com")).toBe("/portal");
    expect(safePortalNextPath("https://example.com")).toBe("/portal");
  });

  it("builds applicant sign-in redirects away from staff routes", () => {
    expect(portalSignInPath("/portal/offers")).toBe("/apply/login?next=%2Fportal%2Foffers");
    expect(portalSignInPath("/finance")).toBe("/apply/login?next=%2Fportal");
  });
});
