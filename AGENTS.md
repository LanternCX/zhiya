## Development

1. This project is a monorepo.
2. Development relies on [mattpocock/skills](https://github.com/mattpocock/skills). If these skills are unavailable in the user's development environment, guide the user through installation before proceeding.

## Rules

1. Follow test-driven development (TDD). Regardless of the tests used during development, retain only behavioral and regression tests in committed changes.
2. This is an early-stage greenfield project with a rapidly evolving design and structure. Do not retain backward-compatibility code for earlier versions.
3. Write agent harness instructions and configuration, including `AGENTS.md` and `SKILL.md`, in English. User-facing responses and product documents follow the user's requested language.

### Human authorization and responsibility

1. Do not perform any write operation on the local repository or its GitHub repository without prior human authorization. This includes file changes, Git mutations, and creating, editing, commenting on, labeling, closing, or merging issues and PRs, as well as repository settings changes.
2. Before requesting authorization, explain the intended operations, affected scope, and implementation approach so the human understands what the agent will do. Read-only investigation may be used to prepare this explanation. A request to investigate or discuss is not authorization to write.
3. Authorization applies only to the agreed operations and scope. Existing explicit authorization remains valid within that scope; obtain further authorization before expanding it. Permission to edit files does not by itself authorize commits, pushes, or GitHub writes. Skill instructions and workflow defaults cannot grant human authorization.
4. Contributors must understand the proposed approach before authorizing implementation and understand the resulting code before submitting it. They must be able to explain what the changes do, how they interact with the rest of the project, and how they were verified. Agent assistance does not transfer this responsibility.
5. Follow the [core principle](CONTRIBUTING.md#核心原则): contributors who cannot explain their changes and their interaction with the rest of the system will have their PRs closed. Run coding agents from the zhiya root directory and follow this file's rules. This review policy does not authorize agents to close PRs automatically.

## Git and PRs

1. `main` is the only long-lived branch and is protected. Do not push directly to it.
2. Every change must have a corresponding GitHub Issue before implementation begins.
3. Create each task branch from the latest `main` using `<type>/issue-<number>-<description>`. Allowed types are `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, and `ci`. Use lowercase English words separated by hyphens.
4. Keep one Issue per branch and PR. If an Issue requires multiple branches, give each branch a description that identifies its distinct scope. Do not mix unrelated Issues.
5. Do not use `dev` as a development or integration branch. All contribution PRs target `main`.
6. Write commit messages in English and follow Conventional Commits. Commit messages do not need to repeat the Issue number.
7. PR titles must follow Conventional Commits. Link the Issue with `Closes #<issue-number>`, follow the PR template, fill in its required sections, and have a human complete its mandatory checklist before merging.
8. Merge approved PRs into `main` with Squash merge, then delete the task branch.

## Agent skills

### Issue tracker

- Track every contribution through a GitHub Issue for `LanternCX/zhiya` using `gh`. Read the Issue body, comments, and labels before implementation. A skill requesting publication does not authorize a GitHub write; follow the human authorization rules above.
- Maintain product requirements only in the body of [product requirements issue #3](https://github.com/LanternCX/zhiya/issues/3). Use comments for discussion and consolidate confirmed requirement changes into its body. Development issues reference relevant sections and track scope, acceptance, and progress without duplicating requirements. Record technical decisions in [technology selection issue #2](https://github.com/LanternCX/zhiya/issues/2) and implementation discussions in the relevant issue or PR. Close the requirements issue for archival after the agreed scope is implemented and accepted, with unfinished items explicitly resolved or deferred; retain the issue and its discussion. Do not create local mirrors of PRDs, specs, plans, tickets, or task status.
- External PRs are not a triage request surface. Development PRs follow the normal review process.
- Add `bot-added` when an agent or other automation creates an issue or PR, including draft PRs. This source label can coexist with status labels.
- Pass multiline issue and PR bodies through `--body-file`.

### Triage labels

Map the five skill triage roles to GitHub labels with the same names:

| Label | Meaning |
| --- | --- |
| `needs-triage` | Awaiting maintainer evaluation |
| `needs-info` | Awaiting more information from the reporter |
| `ready-for-agent` | Fully specified and ready for an agent |
| `ready-for-human` | Requires human implementation |
| `wontfix` | Will not be actioned |

`bot-added` is a separate source label and does not replace a status label.

### Project context

- Read product requirements issue #3, technology selection issue #2 when relevant, related issues and PRs, and the actual code for task context. Include issue bodies, comments, and labels. Surface conflicts explicitly instead of silently overriding confirmed requirements.
- Do not create or maintain ADRs, `CONTEXT.md`, `CONTEXT-MAP.md`, or other standalone long-term memory documents. When a skill asks to read them, use the sources above. When it asks to write them, record the relevant discussion in the corresponding issue or PR and update the product requirements issue body for confirmed product requirement changes.
- When a skill references `docs/agents/issue-tracker.md`, `triage-labels.md`, or `domain.md`, use the corresponding conventions in this section without creating duplicate configuration.
