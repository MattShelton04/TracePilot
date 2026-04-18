# ADR 0001 — Supported platforms

**Status:** Accepted
**Date:** 2026-04

## Context

TracePilot is a Tauri desktop app that wraps the Copilot CLI. Prior to this ADR, support policy was implicit: README says "tested on Windows 10/11", CI ran on `ubuntu-latest` only, and the release workflow built on `windows-latest` only. This ambiguity led to platform-specific regressions landing repeatedly.

## Decision

TracePilot explicitly supports, in tiers:

| Tier | Platform | Guarantee |
|---|---|---|
| 1 | **Windows 10/11 (x64)** | Primary dev + release target; smoke-tested every release. |
| 2 | **macOS 12+ (Apple Silicon + Intel)** | Supported. Artefacts produced. Non-blocking CI lane. |
| 2 | **Linux (x86_64, glibc ≥ 2.31)** | Supported. Artefacts produced. Non-blocking CI lane. |
| 3 | Other | Best effort; community PRs welcome. |

Implications:

1. CI matrix runs `ubuntu-latest`, `windows-latest`, and `macos-latest` for build + test. Lint / fmt / audit gates run only on Linux (single source of truth).
2. Release workflow will be extended to produce artefacts for all three platforms. Tracked in `docs/tech-debt-plan-revised-2026-04.md` Phase 6.1.
3. Platform differences use `cfg(...)` guards; path handling must use `std::path` / `node:path` primitives.
4. Any test with hardcoded `\\` or `/` separators must be refactored.

## Consequences

- CI cost roughly triples for the main check job.
- macOS signing/notarisation becomes a real requirement for artefact distribution — deferred to Phase 6.1.
- `cmd.exe`-specific dev scripts must be ported to pnpm-level commands — Phase 6.3.

## References

- `docs/tech-debt-audit-2026-04.md` — cross-platform drift findings.
- `docs/tech-debt-plan-revised-2026-04.md` Phase 0.2, 0.15, 6.1, 6.3.
