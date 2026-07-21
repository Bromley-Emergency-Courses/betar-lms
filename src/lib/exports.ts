import type { AppData, ExamResult } from "@/lib/types";
import { externalStudentIdentifier, studentDisplayName } from "@/lib/rules";

function csvEscape(value: string | number | boolean | undefined): string {
  const text = value === undefined ? "" : String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

export function cccuExamExportRows(data: AppData): string[][] {
  const rows = [
    [
      "Student ID",
      "Student Name",
      "Term",
      "Module Code",
      "Module Title",
      "Component",
      "Score",
      "Pass Mark",
      "Passed",
      "Resit Required",
      "Attempt Number",
      "Is Resit",
      "Prior Attempt Missing",
      "Taken On",
      "Source System"
    ]
  ];

  data.examResults.forEach((result: ExamResult) => {
    const student = data.students.find((candidate) => candidate.id === result.studentId);
    const offering = data.offerings.find((candidate) => candidate.id === result.offeringId);
    const courseModule = offering ? data.modules.find((candidate) => candidate.id === offering.moduleId) : undefined;
    const term = offering ? data.terms.find((candidate) => candidate.id === offering.termId) : undefined;
    if (!student || !offering || !courseModule || !term) {
      return;
    }

    rows.push([
      externalStudentIdentifier(student),
      studentDisplayName(student),
      term.name,
      courseModule.code,
      courseModule.title,
      result.componentType,
      String(result.score),
      String(result.passMark),
      result.passed ? "Yes" : "No",
      result.resitRequired ? "Yes" : "No",
      String(result.attemptNumber),
      result.isResit ? "Yes" : "No",
      result.priorAttemptMissing ? "Yes" : "No",
      result.takenOn,
      result.sourceSystem
    ]);
  });

  return rows;
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function cccuExamExportCsv(data: AppData): string {
  return rowsToCsv(cccuExamExportRows(data));
}
