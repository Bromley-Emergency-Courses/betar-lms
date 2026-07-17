import Link from "next/link";
import { Field, FormGrid } from "@/components/forms";
import { StatusPill } from "@/components/status-pill";
import {
  deleteCourseModule,
  deleteModuleOffering,
  deleteTerm,
  updateCourseModule,
  updateModuleOffering,
  updateTerm
} from "@/lib/admin-actions";
import { externalStudentIdentifier, formatCurrency, studentDisplayName } from "@/lib/rules";
import type { AppData } from "@/lib/types";

export function DeleteWarning({
  name,
  idName,
  idValue
}: {
  name: string;
  idName: string;
  idValue: string;
}) {
  return (
    <div className="delete-warning">
      <input type="hidden" name={idName} value={idValue} />
      <label>
        <input name="confirm_delete" type="checkbox" required /> Delete {name}
      </label>
      <p>This is permanent. Deletion may be blocked if other records depend on it.</p>
    </div>
  );
}

export function CourseRecords({ data }: { data: AppData }) {
  const studentsById = new Map(data.students.map((student) => [student.id, student]));
  const enrolmentsByOfferingId = new Map<string, AppData["enrolments"]>();
  data.enrolments.forEach((enrolment) => {
    const offeringEnrolments = enrolmentsByOfferingId.get(enrolment.offeringId);
    if (offeringEnrolments) {
      offeringEnrolments.push(enrolment);
    } else {
      enrolmentsByOfferingId.set(enrolment.offeringId, [enrolment]);
    }
  });

  return (
    <>
      <section className="section">
        <div className="section-header">
          <div>
            <h2>Module Catalogue</h2>
            <p>Edit module names, credit values, mode, and mandatory status</p>
          </div>
        </div>
        <div className="record-grid">
          {data.modules.map((courseModule) => (
            <div className="panel grid" key={courseModule.id}>
              <form className="grid" action={updateCourseModule}>
                <input type="hidden" name="module_id" value={courseModule.id} />
                <FormGrid>
                  <Field label="Code" htmlFor={`module-code-${courseModule.id}`}>
                    <input id={`module-code-${courseModule.id}`} name="code" className="input" defaultValue={courseModule.code} required />
                  </Field>
                  <Field label="Credits" htmlFor={`module-credits-${courseModule.id}`}>
                    <input id={`module-credits-${courseModule.id}`} name="credits" className="input" type="number" min="1" defaultValue={courseModule.credits} required />
                  </Field>
                </FormGrid>
                <Field label="Title" htmlFor={`module-title-${courseModule.id}`}>
                  <input id={`module-title-${courseModule.id}`} name="title" className="input" defaultValue={courseModule.title} required />
                </Field>
                <FormGrid>
                  <Field label="Mode" htmlFor={`module-mode-${courseModule.id}`}>
                    <select id={`module-mode-${courseModule.id}`} name="mode" className="select" defaultValue={courseModule.mode}>
                      <option value="practical">Practical</option>
                      <option value="online">Online</option>
                    </select>
                  </Field>
                  <div className="field">
                    <label>Flags</label>
                    <label className="toolbar small">
                      <input name="mandatory" type="checkbox" defaultChecked={courseModule.mandatory} /> Mandatory
                    </label>
                  </div>
                </FormGrid>
                <button className="button primary">Save module</button>
              </form>
              <form action={deleteCourseModule}>
                <DeleteWarning name={courseModule.code} idName="module_id" idValue={courseModule.id} />
                <button className="button danger">Delete module</button>
              </form>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Terms</h2>
            <p>Edit teaching windows and term status</p>
          </div>
        </div>
        <div className="record-grid">
          {data.terms.map((term) => (
            <div className="panel grid" key={term.id}>
              <form className="grid" action={updateTerm}>
                <input type="hidden" name="term_id" value={term.id} />
                <Field label="Name" htmlFor={`term-name-${term.id}`}>
                  <input id={`term-name-${term.id}`} name="name" className="input" defaultValue={term.name} required />
                </Field>
                <FormGrid>
                  <Field label="Starts on" htmlFor={`term-start-${term.id}`}>
                    <input id={`term-start-${term.id}`} name="starts_on" className="input" type="date" defaultValue={term.startsOn} required />
                  </Field>
                  <Field label="Ends on" htmlFor={`term-end-${term.id}`}>
                    <input id={`term-end-${term.id}`} name="ends_on" className="input" type="date" defaultValue={term.endsOn} required />
                  </Field>
                </FormGrid>
                <FormGrid>
                  <Field label="Exam starts" htmlFor={`term-exam-start-${term.id}`}>
                    <input id={`term-exam-start-${term.id}`} name="exam_window_starts_on" className="input" type="date" defaultValue={term.examWindowStartsOn ?? ""} />
                  </Field>
                  <Field label="Exam ends" htmlFor={`term-exam-end-${term.id}`}>
                    <input id={`term-exam-end-${term.id}`} name="exam_window_ends_on" className="input" type="date" defaultValue={term.examWindowEndsOn ?? ""} />
                  </Field>
                </FormGrid>
                <Field label="Status" htmlFor={`term-status-${term.id}`}>
                  <select id={`term-status-${term.id}`} name="status" className="select" defaultValue={term.status}>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="active">Active</option>
                    <option value="closed">Closed</option>
                  </select>
                </Field>
                <button className="button primary">Save term</button>
              </form>
              <form action={deleteTerm}>
                <DeleteWarning name={term.name} idName="term_id" idValue={term.id} />
                <button className="button danger">Delete term</button>
              </form>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>Term Offerings</h2>
            <p>Grouped by term so historic offerings stay scannable</p>
          </div>
        </div>
        <div className="term-groups">
          {data.terms.map((term) => {
            const offerings = data.offerings.filter((offering) => offering.termId === term.id);
            return (
              <details className="panel" key={term.id} open={term.status === "active" || term.status === "published"}>
                <summary className="term-summary">
                  <span>
                    <strong>{term.name}</strong>
                    <span className="muted small">{offerings.length} offerings</span>
                  </span>
                  <StatusPill value={term.status === "active" ? "active" : "neutral"} label={term.status} />
                </summary>
                {offerings.length === 0 ? (
                  <p className="muted">No offerings configured for this term.</p>
                ) : (
                  <div className="offering-grid">
                    {offerings.map((offering) => {
                      const courseModule = data.modules.find((candidate) => candidate.id === offering.moduleId);
                      const offeringEnrolments = enrolmentsByOfferingId.get(offering.id) ?? [];
                      const enrolmentCount = offeringEnrolments.length;
                      return courseModule ? (
                        <div className="card grid" key={offering.id}>
                          <form className="grid" action={updateModuleOffering}>
                            <input type="hidden" name="offering_id" value={offering.id} />
                            <FormGrid>
                              <Field label="Module" htmlFor={`offering-module-${offering.id}`}>
                                <select id={`offering-module-${offering.id}`} name="module_id" className="select" defaultValue={offering.moduleId}>
                                  {data.modules.map((moduleOption) => (
                                    <option key={moduleOption.id} value={moduleOption.id}>
                                      {moduleOption.code}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Term" htmlFor={`offering-term-${offering.id}`}>
                                <select id={`offering-term-${offering.id}`} name="term_id" className="select" defaultValue={offering.termId}>
                                  {data.terms.map((termOption) => (
                                    <option key={termOption.id} value={termOption.id}>
                                      {termOption.name}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Price GBP" htmlFor={`offering-price-${offering.id}`}>
                                <input id={`offering-price-${offering.id}`} name="price" className="input" type="number" min="0" step="0.01" defaultValue={offering.pricePence / 100} required />
                              </Field>
                              <Field label="Capacity" htmlFor={`offering-capacity-${offering.id}`}>
                                <input id={`offering-capacity-${offering.id}`} name="capacity" className="input" type="number" min="1" defaultValue={offering.capacity} required />
                              </Field>
                              <Field label="First practical days" htmlFor={`offering-first-${offering.id}`}>
                                <input id={`offering-first-${offering.id}`} name="attendance_first" className="input" type="number" min="0" defaultValue={offering.attendanceDaysRequiredFirstPractical} required />
                              </Field>
                              <Field label="Subsequent days" htmlFor={`offering-subsequent-${offering.id}`}>
                                <input id={`offering-subsequent-${offering.id}`} name="attendance_subsequent" className="input" type="number" min="0" defaultValue={offering.attendanceDaysRequiredSubsequentPractical} required />
                              </Field>
                            </FormGrid>
                            <label className="toolbar small">
                              <input name="presentation_required" type="checkbox" defaultChecked={offering.presentationRequired} /> Presentation required
                            </label>
                            <div className="toolbar">
                              <button className="button primary">Save offering</button>
                              <span className="muted small">
                                {courseModule.code} · {formatCurrency(offering.pricePence)} · {enrolmentCount} enrolled
                              </span>
                            </div>
                          </form>
                          {enrolmentCount > 0 ? (
                            <div className="delete-blocked">
                              <strong>Deletion blocked</strong>
                              <p>
                                {enrolmentCount} student enrolment{enrolmentCount === 1 ? "" : "s"} still reference this
                                offering. Remove or move those enrolments before deleting it.
                              </p>
                              <details className="blocked-student-details">
                                <summary>
                                  View enrolled student{enrolmentCount === 1 ? "" : "s"}
                                </summary>
                                <div className="blocked-student-list">
                                  {offeringEnrolments.map((enrolment) => {
                                    const student = studentsById.get(enrolment.studentId);
                                    return student ? (
                                      <Link key={enrolment.id} href={`/students/${student.id}?mode=edit`}>
                                        <strong>{studentDisplayName(student)}</strong>
                                        <span>{externalStudentIdentifier(student)}</span>
                                      </Link>
                                    ) : (
                                      <span key={enrolment.id}>Unknown student {enrolment.studentId}</span>
                                    );
                                  })}
                                </div>
                              </details>
                            </div>
                          ) : (
                            <form action={deleteModuleOffering}>
                              <DeleteWarning name={`${term.name} ${courseModule.code}`} idName="offering_id" idValue={offering.id} />
                              <button className="button danger">Delete offering</button>
                            </form>
                          )}
                        </div>
                      ) : null;
                    })}
                  </div>
                )}
              </details>
            );
          })}
        </div>
      </section>
    </>
  );
}

export function CourseOverview({ data }: { data: AppData }) {
  return (
    <>
      <section className="grid grid-4">
        <div className="card">
          <span className="muted small">Modules</span>
          <p>
            <strong>{data.modules.length}</strong>
          </p>
        </div>
        <div className="card">
          <span className="muted small">Terms</span>
          <p>
            <strong>{data.terms.length}</strong>
          </p>
        </div>
        <div className="card">
          <span className="muted small">Offerings</span>
          <p>
            <strong>{data.offerings.length}</strong>
          </p>
        </div>
        <div className="card">
          <span className="muted small">Active modules</span>
          <p>
            <strong>{data.modules.filter((courseModule) => courseModule.active).length}</strong>
          </p>
        </div>
      </section>

      <section className="grid grid-2">
        <div className="section">
          <div className="section-header">
            <div>
              <h2>Module Catalogue</h2>
              <p>Compact module list</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Title</th>
                  <th>Mode</th>
                  <th>Credits</th>
                </tr>
              </thead>
              <tbody>
                {data.modules.map((courseModule) => (
                  <tr key={courseModule.id}>
                    <td>{courseModule.code}</td>
                    <td>{courseModule.title}</td>
                    <td>{courseModule.mode}</td>
                    <td>{courseModule.credits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section">
          <div className="section-header">
            <div>
              <h2>Terms And Offerings</h2>
              <p>Grouped by term for scanning</p>
            </div>
          </div>
          <div className="term-groups">
            {data.terms.map((term) => {
              const offerings = data.offerings.filter((offering) => offering.termId === term.id);
              return (
                <details className="panel" key={term.id} open={term.status === "active" || term.status === "published"}>
                  <summary className="term-summary">
                    <span>
                      <strong>{term.name}</strong>
                      <span className="muted small">
                        {term.startsOn} to {term.endsOn} · {offerings.length} offerings
                      </span>
                    </span>
                    <StatusPill value={term.status === "active" ? "active" : "neutral"} label={term.status} />
                  </summary>
                  <div className="offering-list">
                    {offerings.length === 0 ? <p className="muted small">No offerings configured.</p> : null}
                    {offerings.map((offering) => {
                      const courseModule = data.modules.find((candidate) => candidate.id === offering.moduleId);
                      return courseModule ? (
                        <div className="offering-row" key={offering.id}>
                          <strong>{courseModule.code}</strong>
                          <span>{formatCurrency(offering.pricePence)}</span>
                          <span>{offering.capacity} places</span>
                          <span>{offering.presentationRequired ? "Presentation" : "No presentation"}</span>
                        </div>
                      ) : null;
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
