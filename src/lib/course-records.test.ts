import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CourseRecords } from "@/components/course-records";
import { getAppData } from "./seed";

vi.mock("@/lib/admin-actions", () => ({ deleteCourseModule: vi.fn(), deleteModuleOffering: vi.fn(), deleteTerm: vi.fn(), updateCourseModule: vi.fn(), updateModuleOffering: vi.fn(), updateTerm: vi.fn() }));
vi.mock("@/components/assessment-forms", () => ({ AssessmentPlanForm: () => React.createElement("p", null, "Exam rule form") }));
beforeAll(() => { vi.stubGlobal("React", React); });
describe("familiar Course configuration", () => {
  it("keeps module and term editors visible and offerings grouped by all teaching terms", () => {
    const data = getAppData();
    const html = renderToStaticMarkup(React.createElement(CourseRecords, { data }));
    for (const courseModule of data.modules) expect(html).toContain(`id="module-title-${courseModule.id}"`);
    for (const term of data.terms) expect(html).toContain(`id="term-name-${term.id}"`);
    for (const offering of data.offerings) {
      const term = data.terms.find(candidate => candidate.id === offering.termId)!;
      const field = `name="offering_id" value="${offering.id}"`;
      if (term.status === "active" || term.status === "published") expect(html).toContain(field);
      else expect(html).not.toContain(field);
    }
    for (const term of data.terms) expect(html).toContain(`<strong>${term.name}</strong>`);
    expect(html).not.toContain('name="offeringTerm"');
    expect(html).not.toContain("Exam rules");
  });

  it("adds only collapsed exam rules within module editors when enabled", () => {
    const data = getAppData();
    const html = renderToStaticMarkup(React.createElement(CourseRecords, { data, assessmentPlans: [] }));
    for (const courseModule of data.modules) {
      expect(html).toContain(`<details id="assessment-plan-${courseModule.id}"><summary>Exam rules · Review required</summary></details>`);
    }
    expect(html).not.toContain("Exam rule form");
    expect(html).not.toContain("Review rules for existing enrolments");
  });
});
