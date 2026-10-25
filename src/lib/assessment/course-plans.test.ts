import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InheritedPlansPage from "@/app/course/assessment-plans/[moduleId]/page";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";
import { getAppData } from "@/lib/seed";
import { readAssessmentTable } from ".";
import { assessmentWorkflowEnabled } from "./feature";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/lms-data", () => ({ getLmsData: vi.fn() }));
vi.mock("@/lib/assessment", () => ({ readAssessmentTable: vi.fn() }));
vi.mock("./feature", () => ({ assessmentWorkflowEnabled: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("Not found"); } }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/assessment-forms", () => ({ PlanMigrationForm: () => React.createElement("p", null, "Migration form") }));

const data = getAppData();
const enrolment = data.enrolments[0];
const offering = data.offerings.find(row => row.id === enrolment.offeringId)!;
const courseModule = data.modules.find(row => row.id === offering.moduleId)!;
const outcome = { enrolment_id: enrolment.id, student_name: "Plan review student", student_identifier: "PLAN-TEST", original_cohort: "Original term", assessment: { enrolment_id: enrolment.id, needs_plan: true } };
const render = async (term?: string, selected = enrolment.id) => renderToStaticMarkup(await InheritedPlansPage({ params: Promise.resolve({ moduleId: courseModule.id }), searchParams: Promise.resolve({ term, enrolment: selected }) }));

beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("React", React);
  vi.mocked(assessmentWorkflowEnabled).mockReturnValue(true);
  vi.mocked(getLmsData).mockResolvedValue(data);
  vi.mocked(readAssessmentTable).mockImplementation(async table => table === "module_assessment_plans" ? [{ id: "reviewed-plan", version: 1 }] : [outcome]);
});
describe("Course-owned inherited plan review", () => {
  it("requires Course permission before reading any student or plan data", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("Denied"));
    await expect(render()).rejects.toThrow("Denied");
    expect(requirePermission).toHaveBeenCalledWith("manage_course");
    expect(getLmsData).not.toHaveBeenCalled(); expect(readAssessmentTable).not.toHaveBeenCalled();
  });
  it("is unavailable when the assessment workflow is off", async () => {
    vi.mocked(assessmentWorkflowEnabled).mockReturnValue(false);
    await expect(render()).rejects.toThrow("Not found"); expect(getLmsData).not.toHaveBeenCalled();
  });
  it("filters unassigned historical plans using the real teaching enrolment, not absent projection fields", async () => {
    const html = await render(offering.termId);
    expect(html).toContain("Migration form"); expect(html).toContain("Current plan: not assigned");
    expect(readAssessmentTable).toHaveBeenCalledWith("module_assessment_plans", { column: "module_id", value: courseModule.id });
    expect(readAssessmentTable).toHaveBeenCalledWith("assessment_outcomes", { column: "module_code", value: courseModule.code });
  });
  it("cannot select an enrolment outside the selected original teaching term", async () => {
    const html = await render("another-term"); expect(html).toContain("No enrolments"); expect(html).not.toContain("Migration form");
  });
  it("does not expose a migration form for an unknown enrolment", async () => {
    expect(await render(undefined, "unknown")).not.toContain("Migration form");
  });
});
