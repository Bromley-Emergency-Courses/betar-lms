# Domain Docs

This repository uses a single-context layout: `GLOSSARY.md` at the repository root and architecture decision records in `docs/adr/`.

## Before exploring

Read the root `GLOSSARY.md` and any ADRs in `docs/adr/` relevant to the area being explored.

If these files do not exist, proceed silently. The `domain-modeling` skill creates them when terms or decisions are resolved; setup does not create placeholder documents.

## Use the glossary's vocabulary

Use the glossary's terms when naming domain concepts in issues, proposals, hypotheses, and tests. If a needed concept is missing, check whether an existing term fits; otherwise note the gap for `domain-modeling`.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, identify the decision and explain why it should be reconsidered rather than silently overriding it.
