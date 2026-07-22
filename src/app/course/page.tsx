import { Eye, Pencil } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  AssessmentDefinitionCreator,
  AssessmentDefinitionOverview,
  AssessmentDefinitionRecords
} from "@/components/assessment-definition-records";
import { CourseOverview, CourseRecords } from "@/components/course-records";
import { EmptyState } from "@/components/empty-state";
import { Field, FormGrid } from "@/components/forms";
import { requirePermission } from "@/lib/auth";
import { createCourseModule, createModuleOffering, createTerm } from "@/lib/admin-actions";
import { getLmsData } from "@/lib/lms-data";

export default async function CoursePage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  await requirePermission("manage_course");
  const { mode } = await searchParams;
  const editMode = mode === "edit";
  const data = await getLmsData();

  return (
    <AppShell
      title="Course Configuration"
      subtitle="Terms, modules, offerings, pricing, attendance requirements, and scoring definitions"
      actions={
        editMode ? (
          <Link className="button" href="/course">
            <Eye size={16} />
            View mode
          </Link>
        ) : (
          <Link className="button primary" href="/course?mode=edit">
            <Pencil size={16} />
            Edit mode
          </Link>
        )
      }
    >
      {editMode ? (
        <>
          <section className="grid grid-3">
            <form id="add-module" className="panel grid" action={createCourseModule}>
              <div className="section-header">
                <div>
                  <h2>Add Module</h2>
                  <p>Catalogue entry used across term offerings</p>
                </div>
              </div>
              <Field label="Code" htmlFor="module-code">
                <input id="module-code" name="code" className="input" placeholder="POCUS-CORE" required />
              </Field>
              <Field label="Title" htmlFor="module-title">
                <input id="module-title" name="title" className="input" placeholder="Foundations of POCUS" required />
              </Field>
              <FormGrid>
                <Field label="Credits" htmlFor="module-credits">
                  <input
                    id="module-credits"
                    name="credits"
                    className="input"
                    type="number"
                    min="1"
                    defaultValue="10"
                    required
                  />
                </Field>
                <Field label="Mode" htmlFor="module-mode">
                  <select id="module-mode" name="mode" className="select" defaultValue="practical">
                    <option value="practical">Practical</option>
                    <option value="online">Online</option>
                  </select>
                </Field>
              </FormGrid>
              <label className="toolbar small">
                <input name="mandatory" type="checkbox" /> Mandatory PGCert module
              </label>
              <button className="button primary">Save module</button>
            </form>

            <form className="panel grid" action={createTerm}>
              <div className="section-header">
                <div>
                  <h2>Add Term</h2>
                  <p>Teaching and exam window configuration</p>
                </div>
              </div>
              <Field label="Name" htmlFor="term-name">
                <input id="term-name" name="name" className="input" placeholder="September 2026" required />
              </Field>
              <FormGrid>
                <Field label="Starts on" htmlFor="term-starts">
                  <input id="term-starts" name="starts_on" className="input" type="date" required />
                </Field>
                <Field label="Ends on" htmlFor="term-ends">
                  <input id="term-ends" name="ends_on" className="input" type="date" required />
                </Field>
              </FormGrid>
              <FormGrid>
                <Field label="Exam starts" htmlFor="term-exam-starts">
                  <input id="term-exam-starts" name="exam_window_starts_on" className="input" type="date" />
                </Field>
                <Field label="Exam ends" htmlFor="term-exam-ends">
                  <input id="term-exam-ends" name="exam_window_ends_on" className="input" type="date" />
                </Field>
              </FormGrid>
              <Field label="Status" htmlFor="term-status">
                <select id="term-status" name="status" className="select" defaultValue="draft">
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </Field>
              <button className="button primary">Save term</button>
            </form>

            <form className="panel grid" action={createModuleOffering}>
              <div className="section-header">
                <div>
                  <h2>Add Offering</h2>
                  <p>Attach a module to a term</p>
                </div>
              </div>
              <Field label="Module" htmlFor="offering-module">
                <select
                  id="offering-module"
                  name="module_id"
                  className="select"
                  required
                  disabled={data.modules.length === 0}
                >
                  <option value="">Select module</option>
                  {data.modules.map((courseModule) => (
                    <option key={courseModule.id} value={courseModule.id}>
                      {courseModule.code} · {courseModule.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Term" htmlFor="offering-term">
                <select id="offering-term" name="term_id" className="select" required disabled={data.terms.length === 0}>
                  <option value="">Select term</option>
                  {data.terms.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name}
                    </option>
                  ))}
                </select>
              </Field>
              <FormGrid>
                <Field label="Price GBP" htmlFor="offering-price">
                  <input
                    id="offering-price"
                    name="price"
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue="900"
                    required
                  />
                </Field>
                <Field label="Capacity" htmlFor="offering-capacity">
                  <input
                    id="offering-capacity"
                    name="capacity"
                    className="input"
                    type="number"
                    min="1"
                    defaultValue="18"
                    required
                  />
                </Field>
              </FormGrid>
              <FormGrid>
                <Field label="First practical days" htmlFor="attendance-first">
                  <input
                    id="attendance-first"
                    name="attendance_first"
                    className="input"
                    type="number"
                    min="0"
                    defaultValue="3"
                    required
                  />
                </Field>
                <Field label="Subsequent days" htmlFor="attendance-subsequent">
                  <input
                    id="attendance-subsequent"
                    name="attendance_subsequent"
                    className="input"
                    type="number"
                    min="0"
                    defaultValue="2"
                    required
                  />
                </Field>
              </FormGrid>
              <label className="toolbar small">
                <input name="presentation_required" type="checkbox" defaultChecked /> Presentation required
              </label>
              <button className="button primary" disabled={data.modules.length === 0 || data.terms.length === 0}>
                Save offering
              </button>
            </form>

            <AssessmentDefinitionCreator data={data} />
          </section>

          <CourseRecords data={data} />
          <AssessmentDefinitionRecords data={data} />
        </>
      ) : data.modules.length === 0 && data.terms.length === 0 ? (
        <EmptyState title="No course setup yet" detail="Enter edit mode to add modules, terms, and offerings." />
      ) : (
        <>
          <CourseOverview data={data} />
          {data.assessmentDefinitions.length === 0 ? (
            <EmptyState title="No assessment definitions" detail="Enter edit mode to add configurable formative assessment forms." />
          ) : (
            <AssessmentDefinitionOverview data={data} />
          )}
        </>
      )}
    </AppShell>
  );
}
