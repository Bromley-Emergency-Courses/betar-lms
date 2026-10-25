import { describe, expect, it } from "vitest";
import { getAppData } from "./seed";
import { buildStudentWorkspaceData } from "./student-workspace";

describe("student workspace saved records", () => {
  it("distinguishes an unmarked shared session from an explicitly expected student", () => {
    const data = structuredClone(getAppData());
    data.attendance = [];
    const workspace = buildStudentWorkspaceData(data, "student-1", false);
    expect(workspace.attendance.find(record => record.id === "session-card-1")?.status).toBe("expected");
    expect(workspace.attendance.find(record => record.id === "session-lung-1")?.status).toBe("not_recorded");
  });

  it("keeps saved attendance and check-in evidence separate from expectations", () => {
    const data = structuredClone(getAppData());
    const record = buildStudentWorkspaceData(data, "student-1", false).attendance.find(record => record.id === "session-card-1");
    expect(record).toMatchObject({ status: "attended", checkedInAt: "2026-05-04T08:52:00.000Z", checkedOutAt: "2026-05-04T16:58:00.000Z" });
  });

  it("omits finance without permission and preserves unknown amounts rather than zero", () => {
    const data = structuredClone(getAppData());
    expect(buildStudentWorkspaceData(data, "student-2", false).finance).toEqual([]);
    const records = buildStudentWorkspaceData(data, "student-2", true).finance;
    expect(records).toHaveLength(1);
    expect(records[0].paidAmountPence).toBeUndefined();
    expect(records[0].invoiceAmountPence).toBe(90000);
  });

  it("retains formative items, zero scores, rubric values, authors and comments", () => {
    const data = structuredClone(getAppData());
    data.assessmentAttempts[0].overallScore = 0;
    data.assessmentAttempts[0].scores = { image_quality: 0 };
    const teaching = buildStudentWorkspaceData(data, "student-1", false).teaching;
    const record = teaching.find(record => record.type === "Formative assessment");
    expect(record?.author).toBe("Mark Ellison");
    expect(record?.text).toBe("Repeat LVOT measurement next session.");
    expect(record?.details).toContainEqual({ label: "Overall score", value: "0" });
    expect(record?.details.filter(detail => detail.label === "Assessed item")).toHaveLength(3);
    expect(record?.details.some(detail => detail.label !== "Overall score" && detail.value === "0")).toBe(true);
    expect(teaching.some(record => record.id === "presentation-1")).toBe(false);
  });

  it("preserves the presentation type, duration, total and every rubric field", () => {
    const data = structuredClone(getAppData());
    const record = buildStudentWorkspaceData(data, "student-2", false).teaching.find(record => record.type === "Presentation");
    expect(record?.details).toEqual(expect.arrayContaining([
      { label: "Type", value: "case presentation" },
      { label: "Duration", value: "20 minutes" },
      { label: "Total score", value: "42" }
    ]));
    expect(record?.details).toHaveLength(3 + Object.keys(data.presentationScores[0].scores).length);
  });
});
