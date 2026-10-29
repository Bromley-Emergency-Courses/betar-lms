import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CoursePage from "@/app/course/page";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";
import { readAssessmentTable } from "@/lib/assessment";
import { assessmentOperationsPaused, assessmentWorkflowEnabled } from "@/lib/assessment/feature";
import { getAppData } from "./seed";

vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/lms-data", () => ({ getLmsData: vi.fn() }));
vi.mock("@/lib/assessment", () => ({ readAssessmentTable: vi.fn() }));
vi.mock("@/lib/assessment/feature", () => ({ assessmentWorkflowEnabled: vi.fn(), assessmentOperationsPaused: vi.fn(() => false) }));
vi.mock("@/lib/admin-actions", () => ({ createCourseModule: vi.fn(), createModuleOffering: vi.fn(), createTerm: vi.fn() }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/course-records", () => ({
  CourseOverview: () => React.createElement("p", null, "Existing course overview"),
  CourseRecords: ({ assessmentPlans }: { assessmentPlans?: unknown[] }) => React.createElement("p", null, assessmentPlans ? "Module editors with exam rules" : "Existing module editors")
}));
vi.mock("@/components/assessment-definition-records", () => ({
  AssessmentDefinitionCreator: () => null,
  AssessmentDefinitionOverview: () => null,
  AssessmentDefinitionRecords: () => null
}));

const render = async (mode?: string) => renderToStaticMarkup(await CoursePage({ searchParams: Promise.resolve({ mode }) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("React", React);
  vi.mocked(getLmsData).mockResolvedValue(getAppData());
  vi.mocked(assessmentWorkflowEnabled).mockReturnValue(true);
  vi.mocked(readAssessmentTable).mockResolvedValue([]);
});

describe("minimal Course assessment integration", () => {
  it("keeps configuration readable but suppresses editors during limited reopening", async () => {
    vi.mocked(assessmentOperationsPaused).mockReturnValue(true);
    const html = await render("edit");
    expect(html).toContain("Existing course overview");
    expect(html).not.toContain("Add Module");
    expect(readAssessmentTable).not.toHaveBeenCalled();
  });
  it("leaves the normal course overview unchanged without querying assessment plans", async () => {
    expect(await render()).toContain("Existing course overview");
    expect(readAssessmentTable).not.toHaveBeenCalled();
  });

  it("adds exam rules to the existing module editors only in enabled edit mode", async () => {
    const html = await render("edit");
    expect(html).toContain("Add Module");
    expect(html).toContain("Module editors with exam rules");
    expect(html).not.toContain("Module assessment plans");
    expect(readAssessmentTable).toHaveBeenCalledWith("module_assessment_plans");
  });

  it("keeps legacy edit mode when the assessment workflow is off", async () => {
    vi.mocked(assessmentWorkflowEnabled).mockReturnValue(false);
    expect(await render("edit")).toContain("Existing module editors");
    expect(readAssessmentTable).not.toHaveBeenCalled();
  });

  it("checks Course permission before loading configuration", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("Denied"));
    await expect(render("edit")).rejects.toThrow("Denied");
    expect(requirePermission).toHaveBeenCalledWith("manage_course");
    expect(getLmsData).not.toHaveBeenCalled();
    expect(readAssessmentTable).not.toHaveBeenCalled();
  });
});
