# Throwaway connected student workspace

Question: how should staff access assessment, attendance, teaching and finance records without duplicating them or expanding every form on one page?

Three variants on the existing authenticated `/students/[id]?variant=A|B|C` route, development only:

- A: tabbed profile with persistent identity/photo, a compact overview and separate task sections.
- B: split workspace with a persistent context rail and one working section at a time. Selected by the user on 2026-10-22.
- C: summary dashboard with task-specific slide-over panels.

All use the approved assessment table with an optional board toggle. The same assessment prototype is embedded, not copied. The connected directory at `/students?variant=A` links to the profile. `/assessments?variant=A&workspace=1` is the cross-student assessment table/board; its detail dialog links to the student and relevant attendance section.

Run `npm run assessment:prototype` for this workspace's local preview. The development server may already be running on port 3100. Local credentials are in `.context/assessment-browser/login.json`.

Example review URL: `http://127.0.0.1:3100/students/49000000-0000-4000-8000-000000000002?variant=B&cases=examples`. Remove `cases=examples` to read the local synthetic records. Example attendance, finance, notes and module data are explicitly fictional and live only in memory.

Dialog actions never call server mutations. Attendance, finance and note edits update only the preview; picture selection uses a FileReader and never uploads. Module outcome recalculation after attendance edits is intentionally not simulated. The preview says so rather than reimplementing the canonical evaluator. Assessment simulations and overview summaries are not yet a shared live state; navigating/reloading can discard edits. This is a design exploration, not production code.

Finance data is omitted from client props for roles without finance permission. Teachers can preview teaching-note entry but not assessment, attendance or finance edits. Administrative audit JSON is not rendered. Photos use the existing authenticated photo endpoint for existing records, with initials when no photo exists.

Approved direction: student workspace B, embedding assessment version A with an optional version C board. Keep the lightweight, professional styling and compact task-specific dialogs.

Requested refinements, not yet implemented:

- Remove the generic "Student workspace / One student · connected records" header and its unused vertical space. Reference: `.context/attachments/QJdoSn/Screenshot 2026-10-22 at 17.10.16.png`.
- Move the breadcrumb, student identity/context area and summary metrics to the top. Reference: `.context/attachments/QkU9Ld/Screenshot 2026-10-22 at 17.10.34.png`.
- When scrolling past the original name/photo section, smoothly reveal a compact pinned student identity header. Keep the student's identity visible without a layout jump; determine mobile behaviour and respect reduced-motion preferences during implementation planning.

Next step is a separate Wayfinder planning conversation for safe integration, not direct replacement of the real profile. Preserve edit mode, student/profile/photo editing, enrolment creation and editing, attendance date/session creation and recording, teaching notes and finance workflows. Inventory existing permissions and mutations before connecting this presentation to live commands. The preview is not feature-complete or production-approved.

No branch changes or commits: the user's request is local review first. A source/evidence snapshot is preserved under `.context/design-handoff-2026-10-22/`; see its manifest for scope and exclusions.
