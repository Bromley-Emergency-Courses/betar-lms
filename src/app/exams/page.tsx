import { Download, Eye, Pencil, PlugZap } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ExamResultsTable, ExamSummary, ExamTools } from "@/components/exam-records";
import { requirePermission } from "@/lib/auth";
import { getExamPortalPickerExams } from "@/lib/exam-portal";
import { getLmsData } from "@/lib/lms-data";

export default async function ExamsPage({
  searchParams
}: {
  searchParams: Promise<{
    mode?: string;
    examSearch?: string;
    student?: string;
    practicalAccepted?: string;
    practicalRejected?: string;
  }>;
}) {
  const profile = await requirePermission("view_students");
  const { mode, examSearch = "", student, practicalAccepted, practicalRejected } = await searchParams;
  const editMode = profile.role === "admin" && mode === "edit";
  const [data, portalExams] = await Promise.all([
    getLmsData(),
    editMode ? getExamPortalPickerExams(examSearch) : Promise.resolve([])
  ]);
  const selectedStudent = student ? data.students.find((candidate) => candidate.id === student) : undefined;

  return (
    <AppShell
      title="Exam Results"
      subtitle={
        selectedStudent
          ? `Exam results for ${selectedStudent.firstName} ${selectedStudent.lastName}`
          : "Theory and practical result ingestion, pass/fail status, resits, and CCCU exports"
      }
      actions={
        <>
          {profile.role === "admin" ? (
            editMode ? (
              <Link className="button" href={student ? `/exams?student=${student}` : "/exams"}>
                <Eye size={16} />
                View mode
              </Link>
            ) : (
              <Link className="button" href={student ? `/exams?mode=edit&student=${student}` : "/exams?mode=edit"}>
                <Pencil size={16} />
                Edit mode
              </Link>
            )
          ) : null}
          <Link className="button primary" href="/api/exam-adapters/contract">
            <PlugZap size={16} />
            Adapter contract
          </Link>
          <Link className="button" href="/api/exports/cccu-exam-results">
            <Download size={16} />
            CCCU export
          </Link>
        </>
      }
    >
      {editMode ? (
        <ExamTools
          data={data}
          portalExams={portalExams}
          portalSearch={examSearch}
          practicalImportSummary={
            practicalAccepted || practicalRejected
              ? {
                  accepted: Number(practicalAccepted ?? 0),
                  rejected: Number(practicalRejected ?? 0)
                }
              : undefined
          }
        />
      ) : null}
      <ExamSummary data={data} studentId={student} />
      <ExamResultsTable data={data} studentId={student} />
    </AppShell>
  );
}
