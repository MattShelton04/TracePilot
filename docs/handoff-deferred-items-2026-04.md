# Hand-off — Deferred Items from the 2026-04 Tech-Debt Cycle

**Status:** Each item below was on the w63–w130 roadmap but deliberately
skipped during the April cycle (per triage after wave 101). Recording here so
they aren't lost.

---

## w109 — Crash reporting + telemetry (opt-in)

- **Why deferred:** Large scope; requires product + privacy decisions
  (what we collect, where it lands, retention policy, consent UX).
- **What's needed:** Pick a backend (Sentry, self-hosted GlitchTip, Tauri
  plugin). Define an opt-in flow integrated with the existing `FeatureFlag`
  registry. Draft a privacy notice. Tauri-side crash capture + FE error
  boundary hook-up.
- **Pre-reqs:** Privacy review, product sign-off on data surfaces.

## w111 — Multi-OS release matrix (scaffold)

- **Why deferred:** No signing secrets available yet; pure scaffolding offers
  little day-one value until we actually ship.
- **What's needed:** GH Actions matrix for `windows-latest`, `macos-latest`,
  `ubuntu-latest`. Apple notarisation + Windows code-signing steps parked
  behind secret availability. Release-please or equivalent for version bumps.
- **Pre-reqs:** Apple Developer ID, Windows EV cert (or Azure Trusted Signing),
  release workflow decision.

## w112 — SBOM + SLSA provenance

- **Why deferred:** High CI plumbing cost; most valuable at release time, and
  TracePilot has no public distributions yet.
- **What's needed:** `cargo cyclonedx` (or `syft`) generating SBOM for Rust
  crates, `syft` for node deps, attached to release artifacts. SLSA L2/L3 via
  `slsa-framework/slsa-github-generator`.
- **Pre-reqs:** Release workflow (w111) first.

## w113 — git-cliff to CHANGELOG

- **Why deferred:** `cliff.toml` is already checked in; this is a one-step
  config + CI hook once we start cutting versioned releases. Zero value until
  then.
- **What's needed:** A workflow (or lefthook pre-push) that runs
  `git cliff -o CHANGELOG.md` on tag. Confirm section mapping against Conv.
  Commits currently in use.

## w114 — Docs archive + regroup

- **Why deferred:** w62 already did the safe subset. Remaining cleanups are
  subjective and should travel with whoever next edits `/docs/`.

## w116 — Prototype purge

- **Why deferred:** `docs/design/prototypes/` (~2.5 MB of HTML) may still have
  reference value. User to decide whether to archive to a separate repo vs
  delete outright.

## w117 — Future-date fix

- **Why deferred:** Cosmetic. The `2026-*` filenames are correct; the "future"
  label was only a concern for archived reports that no longer matter.

## w118 — w120 — CLI "Option B" rewrite

See dedicated doc: [handoff-cli-option-b-2026-04.md](./handoff-cli-option-b-2026-04.md).

## w129 — `@tracepilot/config` decision

- **Why deferred:** Needs a product/architecture call — extract a standalone
  `@tracepilot/config` package, or fold config into `@tracepilot/client`?
- **What's needed:** Decision, then a small refactor to match.
- **Recommendation:** Fold into `@tracepilot/client` unless the CLI (Option B,
  above) will import config without the client surface.

---

## Also not to forget

The living list of identified-but-deferred improvements (from every wave's
sub-agent) lives in
[`tech-debt-future-improvements-2026-04.md`](./tech-debt-future-improvements-2026-04.md).
That document already contains ~45 finer-grained notes (mostly FE polish +
Rust ergonomics) that future engineers should triage alongside the items
above.
