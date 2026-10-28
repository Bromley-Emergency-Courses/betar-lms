# Throwaway assessment UI exploration

Question: which layout lets non-technical staff identify an enrolment's outcome, understand why, and take the next action without opening technical records?

Three structurally different variants share the existing authenticated `/assessments` route in development only:

- `?variant=A`: compact register, for scanning many enrolments. Recommended starting point.
- `?variant=B`: split review workspace, for working through one enrolment at a time.
- `?variant=C`: follow-up board, organised by the action staff need to take.

Run `npm run assessment:prototype` for this workspace's isolated local Supabase preview, then open http://127.0.0.1:3100/assessments?variant=A. Credentials are in `.context/assessment-browser/login.json`. The floating switcher changes the variant; its arrow-key shortcuts are inactive while editing a field or using a dialog.

The prototype reads the current assessment projections. All dialog actions are in-memory simulations, never server actions or database writes. An explicitly labelled example-data toggle adds cases for resits, abandonment and deferral. Reloading or resetting discards simulations. The outcome simulator is deliberately incomplete and must never become the production evaluator.

Design constraints: compact proportions, status words plus colour/icon (never colour alone), plain-language failure explanations, one task per dialog, brief reasons, and readable result history only on request. Raw audit events, payloads, internal IDs and JSON are not fetched or rendered by the prototype. Technical audit evidence remains untouched in the existing backend.

Staff selected version A with version C available as an optional Table/Board toggle. The connected student workspace selection is version B; see `src/app/students/prototype/README.md`. These letters belong to separate explorations: assessment B is not the selected assessment layout. Production integration and connection to the existing command interface still require planning. No prototype branch or commit is created: the user explicitly requested development review before committing. Matching, plan migration and complete correction/import lifecycles are not implemented in this visual exploration.
