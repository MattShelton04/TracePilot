# Architecture Decision Records

This directory holds TracePilot's Architecture Decision Records (ADRs).
An ADR is a short, dated document that captures **one** significant
architectural decision, the context that produced it, and the
consequences of living with it.

ADRs are historical. Once accepted, an ADR is **not** rewritten — if
the decision is revisited, a new ADR supersedes it and notes the
previous one in its `Status`.

## Index

Foundational architecture (0001–0006):

| # | Title | Status |
|---|---|---|
| [0001](0001-tauri-vue-rust-workspace.md) | Tauri 2 + Vue 3 + Rust workspace architecture | Accepted |
| [0002](0002-ipc-contract-specta-bindings.md) | IPC contract via Specta-generated bindings + invoke wrappers | Accepted |
| [0003](0003-sqlite-wal-per-feature-databases.md) | SQLite persistence with WAL + per-feature databases | Accepted |
| [0004](0004-background-process-discipline.md) | Background process discipline (Windows `CREATE_NO_WINDOW`, `hidden_command`) | Accepted |
| [0005](0005-error-model-thiserror-per-crate.md) | Error model — `thiserror` enums per crate, no `anyhow` in production code | Accepted |
| [0006](0006-frontend-state-pinia-run-helpers.md) | Frontend state — Pinia stores with `runAction` / `runMutation`, no direct mutations | Accepted |
| [0007](0007-copilot-sdk-always-on.md) | Copilot SDK always compiled in, gated at runtime by user preference | Accepted |

Policy ADRs (0010–0013):

| # | Title | Status |
|---|---|---|
| [0010](0010-supported-platforms.md) | Supported platforms (Windows tier-1, macOS + Linux tier-2) | Accepted |
| [0011](0011-tauri-capability-scoping.md) | Tauri capability scoping | Accepted |
| [0012](0012-filesystem-trust-boundary.md) | Filesystem trust boundary + path-jail policy | Accepted |
| [0013](0013-db-migration-policy.md) | DB migration policy (IndexDb / TaskDb / SessionDb) | Accepted |

> **Numbering note.** Policy ADRs originally occupied 0001–0004. They
> were renumbered to 0010+ during Wave 115 so the foundational
> architecture ADRs could take the lowest numbers. Git history
> preserves the rename.

## When to write a new ADR

Write an ADR when **any** of these are true:

1. You are making a cross-cutting decision that will outlive the PR
   that introduces it (e.g. "we use `thiserror` enums", "all IPC goes
   through Specta").
2. Future engineers will reasonably ask "why was this done this way?"
   and the answer is not obvious from the code alone.
3. You are deliberately rejecting alternatives that someone else might
   later re-propose without the context you had.
4. You are changing a previous ADR's decision. In that case write a
   new ADR, set the superseded ADR's status to
   `Superseded by ADR-NNNN`, and link both ways.

Do **not** write an ADR for:

- One-off bug fixes or refactors that touch a single module.
- Style or formatting choices (those belong in `rustfmt.toml` /
  `biome.json`).
- Temporary workarounds (those belong in code comments or in
  `docs/tech-debt-future-improvements-2026-04.md`).

## Numbering

ADRs are numbered sequentially with a four-digit prefix. The next
free number is the lowest integer not already used by a file in this
directory. **Do not renumber** existing ADRs just to keep the sequence
contiguous — renumbering has happened exactly once (Wave 115) and is
expensive because every external reference then rots.

## Template

```markdown
# ADR-NNNN: <short title in sentence case>

Date: YYYY-MM-DD
Status: Proposed | Accepted | Superseded by ADR-NNNN | Deprecated

## Context

Why are we making a decision? What forces are at play — technical
constraints, product requirements, prior bugs, performance budgets?
Cite specific files, issues, or waves when possible.

## Decision

What did we decide? Be concrete. Name the modules, types, functions,
or conventions that implement the decision. Future readers should be
able to find the code from the ADR.

## Consequences

What changes because of this decision? Include both positive and
negative consequences. If the decision introduces maintenance or
review rules, state them here so reviewers can enforce them.

## Alternatives considered

What else did we look at, and why did we reject it? At least two
alternatives is a good rule of thumb — if there are none, the
decision probably isn't worth an ADR.

## References

- Code paths that implement the decision.
- Related ADRs (supersedes / superseded by / informs).
- Relevant wave entries in `docs/tech-debt-master-plan-2026-04.md`.
```

Keep each ADR under ~200 lines. If you need more, you probably have
more than one decision and should split the ADR.

## Process

1. Copy the template into `docs/adr/NNNN-kebab-case-title.md` with
   the next free number.
2. Open the ADR as `Status: Proposed`.
3. Discuss on the PR. Update the ADR until consensus.
4. On merge, the status flips to `Accepted` (or `Superseded` /
   `Deprecated` as applicable).
5. Add a row to the index above.
