"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, LogIn, LogOut } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { checkInStudent, checkOutStudent } from "@/lib/admin-actions";
import type { AppData } from "@/lib/types";
import { studentDisplayName } from "@/lib/rules";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function attendanceKey(sessionId: string, studentId: string): string {
  return `${sessionId}:${studentId}`;
}

export function ReceptionKiosk({ data }: { data: AppData }) {
  const todaySessions = data.sessions.filter((session) => session.sessionDate === todayIsoDate());
  if (todaySessions.length === 0) {
    return (
      <div className="content">
        <EmptyState
          title="No sessions today"
          detail="The check-in station shows teaching sessions configured for today's date."
        />
      </div>
    );
  }

  return <ReceptionKioskSession data={data} initialSessionId={todaySessions[0].id} sessionIds={todaySessions.map((session) => session.id)} />;
}

function ReceptionKioskSession({
  data,
  initialSessionId,
  sessionIds
}: {
  data: AppData;
  initialSessionId: string;
  sessionIds: string[];
}) {
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [isPending, startTransition] = useTransition();
  const todaySession = data.sessions.find((session) => session.id === sessionId)!;
  const availableSessions = data.sessions.filter((session) => sessionIds.includes(session.id));
  const expectedStudents = useMemo(
    () => todaySession.expectedStudentIds.map((id) => data.students.find((student) => student.id === id)).filter(Boolean),
    [data.students, todaySession.expectedStudentIds]
  );
  const [checkedIn, setCheckedIn] = useState<Record<string, "in" | "out">>(() => {
    const initial: Record<string, "in" | "out"> = {};
    data.attendance
      .filter((record) => record.checkedInAt)
      .forEach((record) => {
        initial[attendanceKey(record.sessionId, record.studentId)] = record.checkedOutAt ? "out" : "in";
      });
    return initial;
  });

  function submitAttendance(studentId: string) {
    const key = attendanceKey(todaySession.id, studentId);
    const nextState = checkedIn[key] === "in" ? "out" : "in";
    const formData = new FormData();
    formData.set("session_id", todaySession.id);
    formData.set("student_id", studentId);

    startTransition(async () => {
      if (nextState === "in") {
        await checkInStudent(formData);
      } else {
        await checkOutStudent(formData);
      }
      setCheckedIn((state) => ({
        ...state,
        [key]: nextState
      }));
    });
  }

  return (
    <div className="kiosk">
      <aside className="kiosk-side">
        <div>
          <div className="brand-mark">B</div>
          <h1>BETAR Check-in</h1>
          <p>
            {todaySession.sessionDate} · {todaySession.startsAt}-{todaySession.endsAt}
          </p>
          <p>{todaySession.location}</p>
          {availableSessions.length > 1 ? (
            <div className="kiosk-session-list">
              {availableSessions.map((session) => (
                <button
                  className={session.id === todaySession.id ? "button primary" : "button"}
                  key={session.id}
                  onClick={() => setSessionId(session.id)}
                >
                  {session.startsAt}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <strong>{expectedStudents.length}</strong>
          <p>students expected</p>
        </div>
      </aside>
      <main className="kiosk-main">
        {expectedStudents.map((student) =>
          student ? (
            <button
              className="student-button"
              key={student.id}
              onClick={() => submitAttendance(student.id)}
              disabled={checkedIn[attendanceKey(todaySession.id, student.id)] === "out" || isPending}
            >
              <span>
                <strong>{studentDisplayName(student)}</strong>
                <br />
                <span className="muted small">{student.cccuStudentId ?? student.temporaryId}</span>
              </span>
              {checkedIn[attendanceKey(todaySession.id, student.id)] === "in" ? (
                <span className="button danger">
                  <LogOut size={18} />
                  Check out
                </span>
              ) : checkedIn[attendanceKey(todaySession.id, student.id)] === "out" ? (
                <span className="button">
                  <CheckCircle2 size={18} />
                  Complete
                </span>
              ) : (
                <span className="button primary">
                  <LogIn size={18} />
                  Check in
                </span>
              )}
            </button>
          ) : null
        )}
      </main>
    </div>
  );
}
