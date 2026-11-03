import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ExamsPage from "@/app/exams/page";
import { automaticExamImportsPaused } from "./assessment/import-pause";
import { getExamPortalPickerExams } from "./exam-portal";
import { getLmsData } from "./lms-data";
import { requirePermission } from "./auth";
import { getAppData } from "./seed";

vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ requirePermission: vi.fn() }));
vi.mock("./lms-data", () => ({ getLmsData: vi.fn() }));
vi.mock("./exam-portal", () => ({ getExamPortalPickerExams: vi.fn(async () => []) }));
vi.mock("./assessment/import-pause", () => ({ automaticExamImportsPaused: vi.fn() }));
vi.mock("./admin-actions", () => ({ createExamPortalMapping: vi.fn(), createManualOverallExamResult: vi.fn(), importExamResultsJson: vi.fn(), importPracticalExamResultsCsv: vi.fn(), resolveExamPortalSubmission: vi.fn(), syncExamPortalMapping: vi.fn(), updateExamPortalMapping: vi.fn() }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/enrolment-assessments", () => ({ EnrolmentAssessments: ({ editMode }: { editMode: boolean }) => React.createElement("p", null, editMode ? "Manual assessment editing available" : "Read-only assessments") }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubEnv("ASSESSMENT_WORKFLOW_MODE", "live");
  vi.stubEnv("ASSESSMENT_OPERATIONS_PAUSED", "false");
  vi.mocked(requirePermission).mockResolvedValue({ id: "admin", role: "admin", fullName: "Synthetic Admin", active: true });
  vi.mocked(getLmsData).mockResolvedValue(getAppData());
  vi.mocked(automaticExamImportsPaused).mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("keeps manual editing and CSV tools but hides paused Portal/JSON controls without fetching Portal exams", async () => {
  const html = renderToStaticMarkup(await ExamsPage({ searchParams: Promise.resolve({ mode: "edit" }) }));
  expect(html).toContain("Automatic exam imports are temporarily paused");
  expect(html).toContain("Manual assessment editing available");
  expect(html).toContain("Practical Results CSV");
  expect(html).not.toContain("Exam Portal Picker");
  expect(html).not.toContain("Sync from Exam Portal");
  expect(html).not.toContain("Manual JSON Import");
  expect(getExamPortalPickerExams).not.toHaveBeenCalled();
});
it("restores Portal tools only when the database permits imports", async () => {
  vi.mocked(automaticExamImportsPaused).mockResolvedValue(false);
  const html = renderToStaticMarkup(await ExamsPage({ searchParams: Promise.resolve({ mode: "edit" }) }));
  expect(html).toContain("Exam Portal Picker");
  expect(html).toContain("Manual JSON Import");
  expect(getExamPortalPickerExams).toHaveBeenCalledOnce();
});
it("does not unlock manual editing while the overall assessment pause remains", async () => {
  vi.stubEnv("ASSESSMENT_OPERATIONS_PAUSED", "true");
  const html = renderToStaticMarkup(await ExamsPage({ searchParams: Promise.resolve({ mode: "edit" }) }));
  expect(html).toContain("Read-only assessments");
  expect(html).not.toContain("Manual assessment editing available");
  expect(getExamPortalPickerExams).not.toHaveBeenCalled();
});
