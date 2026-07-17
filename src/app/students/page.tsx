import Link from "next/link";
import { Eye, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Field, FormGrid } from "@/components/forms";
import { StudentDirectoryTable } from "@/components/student-directory-table";
import { requirePermission } from "@/lib/auth";
import { createStudent } from "@/lib/admin-actions";
import { getLmsData } from "@/lib/lms-data";

export default async function StudentsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; mode?: string }>;
}) {
  const profile = await requirePermission("view_students");
  const { q, mode } = await searchParams;
  const addMode = profile.role === "admin" && mode === "add";
  const data = await getLmsData();

  return (
    <AppShell
      title="Students"
      subtitle="Profiles, enrolments, finance, attendance, documents, and progression"
      actions={
        profile.role === "admin" ? (
          addMode ? (
            <Link className="button" href="/students">
              <Eye size={16} />
              View mode
            </Link>
          ) : (
            <Link className="button primary" href="/students?mode=add">
              <Plus size={16} />
              Add student
            </Link>
          )
        ) : null
      }
    >
      {addMode ? (
      <form id="add-student" className="panel grid" action={createStudent}>
        <div className="section-header">
          <div>
            <h2>Add Student Or Prospect</h2>
            <p>Create a managed record in Supabase</p>
          </div>
          <Link className="button" href="/imports">
            Import templates
          </Link>
        </div>
        <FormGrid>
          <Field label="First name" htmlFor="first-name">
            <input id="first-name" name="first_name" className="input" required />
          </Field>
          <Field label="Last name" htmlFor="last-name">
            <input id="last-name" name="last_name" className="input" required />
          </Field>
          <Field label="Email" htmlFor="student-email">
            <input id="student-email" name="email" className="input" type="email" required />
          </Field>
          <Field label="Phone" htmlFor="student-phone">
            <input id="student-phone" name="phone" className="input" />
          </Field>
          <Field label="Temporary ID" htmlFor="temporary-id">
            <input id="temporary-id" name="temporary_id" className="input" placeholder="Auto-generated if blank" />
          </Field>
          <Field label="CCCU student ID" htmlFor="cccu-id">
            <input id="cccu-id" name="cccu_student_id" className="input" />
          </Field>
          <Field label="Programme" htmlFor="programme">
            <select id="programme" name="programme" className="select" defaultValue="pgcert">
              <option value="pgcert">PGCert</option>
              <option value="microcredential">Microcredential</option>
            </select>
          </Field>
          <Field label="Start term" htmlFor="start-term">
            <select id="start-term" name="start_term_id" className="select">
              <option value="">Not set</option>
              {data.terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Student status" htmlFor="student-status">
            <select id="student-status" name="status" className="select" defaultValue="prospect">
              <option value="prospect">Prospect</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="deferred">Deferred</option>
              <option value="interrupted">Interrupted</option>
            </select>
          </Field>
          <Field label="Admission stage" htmlFor="admission-stage">
            <select id="admission-stage" name="admission_stage" className="select" defaultValue="interest">
              <option value="interest">Interest</option>
              <option value="application_invited">Application invited</option>
              <option value="submitted">Submitted</option>
              <option value="reviewed">Reviewed</option>
              <option value="offered">Offered</option>
              <option value="rejected">Rejected</option>
              <option value="accepted">Accepted</option>
              <option value="cccu_registration_pending">CCCU registration pending</option>
              <option value="cccu_registration_complete">CCCU registration complete</option>
            </select>
          </Field>
        </FormGrid>
        <Field label="Notes" htmlFor="student-notes">
          <textarea id="student-notes" name="notes" className="textarea" />
        </Field>
        <button className="button primary">Create student</button>
      </form>
      ) : null}

      <StudentDirectoryTable data={data} initialSearch={q ?? ""} />
    </AppShell>
  );
}
