import Link from "next/link";
import { Eye, Pencil, TabletSmartphone } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AttendanceUnsavedChangesBoundary } from "@/components/attendance-unsaved-changes";
import {
  AttendanceOverview,
  AttendanceSessionCreator,
  AttendanceSessionRecords,
  AttendanceTermTabs
} from "@/components/attendance-records";
import { EmptyState } from "@/components/empty-state";
import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";

export default async function AttendancePage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string; term?: string }>;
}) {
  const profile = await requirePermission("view_students");
  const { mode, term } = await searchParams;
  const editMode = profile.role === "admin" && mode === "edit";
  const data = await getLmsData();
  const selectedTermId = data.terms.some((candidate) => candidate.id === term) ? term : data.terms[0]?.id;
  const selectedSessions = data.sessions.filter((session) => session.termId === selectedTermId);

  return (
    <AppShell
      title="Attendance"
      subtitle="Teaching sessions, expected attendance, and recorded check-ins"
      actions={
        <div className="toolbar">
          {profile.role === "admin" ? (
            editMode ? (
              <Link className="button" href="/attendance">
                <Eye size={16} />
                View mode
              </Link>
            ) : (
              <Link className="button" href="/attendance?mode=edit">
                <Pencil size={16} />
                Edit mode
              </Link>
            )
          ) : null}
          <Link className="button primary" href="/reception">
            <TabletSmartphone size={16} />
            Reception mode
          </Link>
        </div>
      }
    >
      <AttendanceUnsavedChangesBoundary>
        <AttendanceTermTabs terms={data.terms} selectedTermId={selectedTermId} editMode={editMode} />
        {editMode ? (
          <>
            <AttendanceSessionCreator data={data} selectedTermId={selectedTermId} />
            {data.sessions.length === 0 ? (
              <EmptyState title="No attendance sessions yet" detail="Add the first teaching session above." />
            ) : (
              <AttendanceSessionRecords data={data} selectedTermId={selectedTermId} />
            )}
          </>
        ) : selectedSessions.length === 0 ? (
          <EmptyState title="No attendance sessions yet" detail="Enter edit mode to configure teaching dates and expected attendance." />
        ) : (
          <AttendanceOverview data={data} selectedTermId={selectedTermId} />
        )}
      </AttendanceUnsavedChangesBoundary>
    </AppShell>
  );
}
