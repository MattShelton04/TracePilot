# ADR 0010 — Supported platforms

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
2. Release workflow will be extended to produce artefacts for all three platforms.
3. Platform differences use `cfg(...)` guards; path handling must use `std::path` / `node:path` primitives.
4. Any test with hardcoded `\\` or `/` separators must be refactored.

## Consequences

- CI cost roughly triples for the main check job.
- macOS signing/notarisation becomes a real requirement for artefact distribution — deferred to Phase 6.1.
- `cmd.exe`-specific dev scripts must be ported to pnpm-level commands — Phase 6.3.

## Implementation status (2026-09-25)

The support tiers above record the accepted direction, but the planned
cross-platform release coverage has not landed. Current release assets are
Windows-only; CI runs Rust tests on Windows and Linux, with macOS disabled.
The public README therefore describes Windows as the currently tested target.

## Implementation status (2026-10-04)

Releases add an Apple Silicon (`aarch64`) disk image and updater bundle. The
app is ad-hoc signed, not notarized: users approve the first launch in
Privacy & Security, and in-app updates then install without that prompt
because the updater's download is not quarantined. A non-blocking CI job
builds the bundle and smoke-tests it.

Intel Macs are deferred. Apple has stopped selling them, macOS 26 is the last
release that supports them, and GitHub's Intel runners are being retired.
Adding them later means building `universal-apple-darwin` on the same arm64
runner, roughly doubling the macOS build time, and writing the same updater
bundle to the `darwin-x86_64` entries in the release's updater-manifest job.
Rust tests run on macOS again as a non-blocking matrix leg. Linux artefacts
have not landed.

## References

- Historical cross-platform drift findings and release-plan notes are available in git history before the 2026-05-01 documentation cleanup.
