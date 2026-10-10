---
name: reference-sync
description: Check Zhiya's competition requirements against current code and task decisions, or update the competition reference. Use for requirements alignment, not product implementation.
---

# Reference Sync

## Sources

| Source | Use |
| --- | --- |
| [competition.md](reference/competition.md) → `docs/competition.md` | Official JBGS-2026-02 requirements, scoring, and deliverables |
| [Frontend style guide](reference/DESIGN.md) → `docs/design/DESIGN.md` | Agent-facing frontend visual styles and interaction presentation; not a system architecture or technology guide |
| Current code, configuration, and relevant tests | Evidence of implemented capabilities and deployment behavior |
| Relevant task Issue or PR | Confirmed scope, decisions, acceptance criteria, and unresolved questions |

The competition reference is a relative symlink to the canonical document. Do not create duplicate references or local PRDs.

## Workflow

- Read the competition reference and verify that it resolves to `docs/competition.md`. Keep the scope to JBGS-2026-02 and applicable shared track rules.
- Inspect relevant code and configuration before describing current capabilities. Read task context with `gh issue view <number> --repo LanternCX/zhiya --json body,comments,labels`; use PR context when relevant.
- Distinguish official requirements, current implementation, confirmed task decisions, and open questions. Code or tests alone do not establish acceptance or educational quality. Report conflicts instead of silently treating either historical plans or incomplete implementation as confirmed requirements.
- For a check request, report gaps without editing. For an authorized reference update, modify only confirmed official requirements in the canonical competition document and check identifiers, minimum counts, scoring totals, deliverables, structure, and links.
- Record product and technical decisions in the relevant task Issue or PR when authorized. Follow `AGENTS.md` for write authorization and documentation conventions.

Report what was checked, the evidence and its limits, and any unresolved decisions. Do not start product implementation or commit as part of reference alignment.
