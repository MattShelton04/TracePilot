# Dependency maintenance roadmap

[Overview](README.md) · [Decisions and risk rubric](upgrades.md) · [Security](security.md) · [Measured results](measurements.md)

This is a queue of concrete changes and decisions. Completed work is already in the audit branch; deferred work is not included in measured savings. Effort assumes one engineer familiar with TracePilot and available Windows tooling. Risk scores use the ordinal rubric, not probabilities.

## Completed implementation

| ID / priority | Delivered scope | Benefit | Acceptance and rollback |
| --- | --- | --- | --- |
| B01 / P1 | Root/member Cargo declarations, Tokio/Axum/UUID features, workspace license inheritance | Clearer dependency ownership; Axum extractor package removed; seven missing-license findings removed. No promise that a removed direct edge removes a shared package. | Rust tests, all-target/default/optional checks and native application; restore only this manifest/lock patch if a required consumer is found. |
| B02 / P0 | lru 0.18.5, anyhow 1.0.104, event-listener 5.4.2 | Four RustSec unsoundness warning instances resolved. | Same-DB audit, cache tests, native session flows; rollback reopens advisories and must be recorded. |
| B03 / P0 | Vitest 4.1.11, Vite 6.4.3, tsx 4.23.15, esbuild 0.28.2 and compatible transitive fixes; associated test-mock migration | Full pnpm scan goes from 27 unique advisories to zero. | Strict install, unit/type/build/CLI tests and native/CT checks; catalog/lock and mock changes roll back together. |
| B04 / P0 | pnpm 10.34.5 pins, explicit Lefthook 2.1.14 opt-in, accurate Node floor, expanded CI audits | Patch package-manager advisory; remove silently missing hook provisioning; cover development and isolated npm security scopes. | Fresh frozen install, hook binary without hook mutation, policy checks; retain CI gates even if provisioning must be adjusted. |
| B05 / P2 | Three redundant JS direct declarations removed | Correct direct ownership; remove deprecated type stub. Compiler-dom removal was rejected after its generated CT consumer failed. | Consumer type/build/CT checks; compiler restored. One CT screenshot mismatch reproduces at baseline. |
| B06 / P1 | Graph capture/generation/tests and maintained inventories, version matrices, security and measurement records | Complete repeatable coverage, including platform and peer contexts and the separate npm island. | Graph invariants, source/hash and documentation reconciliation; raw evidence remains ignored. |
| V01 / P1 | CLI native todos smoke and loopback malformed/oversized request recovery tests | Close behavioral gaps relevant to native module and HTTP feature changes. | Run existing CLI and listener test commands; no added product dependency or replacement implementation. |

The measured combined result, not a sum of batch estimates, is authoritative. Detailed pass/fail results and platform limits are in [measurements](measurements.md).

## Next five actions

### R01 — Resolve distribution license and internal-version policy (P1, decision required)

**Scope:** deny.toml, root/member Cargo.toml and scripts/bump-version.ps1. Certificate-data packages webpki-root-certs 1.0.6 and webpki-roots 1.0.6 use CDLA-Permissive-2.0, which remains outside the allow list; seven wildcard diagnostic groups cover 16 versionless internal dependency edges under the existing policy (17 at baseline). The seven missing first-party license declarations have been fixed.

**Next step:** decide whether the certificate-data terms fit the distribution policy, preserving attribution requirements, and whether internal crates need synchronized publishable versions or a narrowly documented private-workspace policy. Do not add blanket ignores. A version-annotation change must update release bump automation and test a future version, not just today's 0.8.2.

**Benefit:** address nine remaining non-advisory cargo-deny errors. **Change risk:** 3×5=15 before legal/distribution and release-tool validation; post-validation remains unresolved. **Stay risk:** 3×5=15 for a release policy that cannot pass; confidence high for the findings, medium for the remedy. **Effort:** 0.5–2 engineering days plus the policy decision. **Acceptance:** cargo deny passes these classes without hiding unrelated notices; verify or resolve its seven separate unresolved-workspace-dependency scanner diagnostics; release bump dry run changes all required versions; notices retained in distribution. **Rollback:** restore the specific policy/version/tooling patch. No arbitrary new dependency version is the remedy.

### R02 — Trial the current Node 22 LTS security patch (P1)

**Scope:** .node-version, Node setup actions, native better-sqlite3 runtime and developer tools. **Trial target verified during this audit:** Node **22.23.3**; recheck the current official 22.x security release at execution. The delivered dependency comparison deliberately holds Node at 22.19.0.

**Benefit:** supported runtime maintenance and security fixes without changing the major ABI line. **Change risk:** 2×4=8 before validation; target 1×4=4 afterward. **Stay risk:** 3×4=12 from missing subsequent runtime fixes; exact applicable advisory exposure requires release-note review. Confidence medium. **Effort:** 0.5–1 day. **Acceptance:** fresh frozen install, native CLI todos smoke, full unit/type suite, visual harness and real WebView2 integration under the new Node; report toolchain effect separately from package effects. **Rollback:** restore Node pins only, preserve patched pnpm and dependency locks.

### R03 — Coordinate a Tauri/platform maintenance trial (P1)

**Scope:** Rust Tauri/core/build/plugins, JS API/CLI/plugin wrappers, capabilities, native WebView/GTK dependencies. **Trial candidates:** tauri **2.12.0**, tauri-build **2.7.0** and the exact plugin candidates in the [Rust](rust-versions.md) and [JavaScript](javascript-versions.md) matrices. Versions need not match numerically.

**Benefit:** evaluate upstream maintenance fixes and supported platform stacks, particularly the old glib/rand and unmaintained paths. A direct Tauri update is **not yet proven** to remove those nodes. **Change risk:** 4×5=20 before native/permission/distribution checks; post-validation unknown. **Stay risk:** 3×5=15 for unresolved platform unsoundness/security-sensitive upstream paths, with Windows/Linux exposure differences in [security](security.md). Confidence medium. **Effort:** 2–5 days, plus Linux runner access. **Dependencies:** R01's distribution decision if license graph changes. **Acceptance:** compare complete graphs and advisories; Linux GTK/WebKit and Windows NSIS journeys, native dialogs/plugins, capabilities/CSP, generated IPC, and updater behavior. Mac packaging requires a supported macOS runner. **Rollback:** coordinated native and JS family patch together, including locks/configuration; never restore only wrapper versions.

### R04 — Migrate the deprecated Lucide package name (P2)

**Scope:** apps/desktop, packages/ui icon imports/templates and manifests. **Target:** **@lucide/vue 1.48.0**, replacing lucide-vue-next 1.0.0; verify release availability again before editing. **Benefit:** leave a deprecated package name while preserving icons. This is a maintenance migration, not a claimed advisory fix.

**Change risk:** 3×3=9 before icon mapping, target 1×3=3 after checks. **Stay risk:** 2×3=6 for accumulating API/maintenance drift. Confidence medium. **Effort:** 1–2 days. **Acceptance:** enumerate every icon import, confirm exported names, strict install, typecheck, component/renderer tests, and 1440×960 / 960×640 / 2560×1440 visual/native checks. **Rollback:** import rename and both manifests/lock as one patch. Avoid mixing a broad Vue/Vite migration into this batch.

### R05 — Validate remaining platform and parent-bound paths (P2)

**Scope:** Linux/macOS resolver-only nodes; SDK reqwest/zip/native-TLS paths; optional diagnostics and source reviews for heavy/native transitive subtrees. Preserve github-copilot-sdk **=1.0.14**, the Specta exact quartet and COPILOT_SKIP_CLI_DOWNLOAD=1 until concrete compatibility evidence supports a new target. No newer SDK stable release was found in the live registry check.

**Benefit:** reduce uncertainty in unexecuted targets and identify whether a supported upstream parent can retire duplicate/legacy families. **Change risk:** 4×5=20 for any protocol/TLS/ownership migration before proof; post-validation unknown. **Stay risk:** 2×5=10 for retained trust/platform complexity; confidence medium. **Effort:** 2–5 days per supported target/family. **Acceptance:** Linux native compile/tests; macOS implementation-status review; generated IPC freshness; controlled protocol-peer ownership/disconnect tests; compare native libraries/features and certificate trust behavior; user-authorized provider test only if actually required. **Rollback:** family-scoped patches. Do not force a transitive override or add a direct dependency merely to reduce a duplicate count.

## Other retained decisions and rejected experiments

- **Rejected B01 experiment:** removing desktop serde_json failed at tauri::generate_context! with E0433. The declaration was restored and documented; no failed experiment is included in the delivered state.
- **Rejected B05 experiment:** removing UI compiler-dom broke the generated Playwright CT entry. Restoring its direct dev declaration repairs the build; the remaining PageHeader screenshot mismatch also reproduces at the untouched baseline. No snapshot baseline was updated.
- **Tokio/UUID:** direct feature trimming is retained, but other consumers still unify required features. Replacing async primitives or writing custom synchronization solely to remove a crate is not justified by measured cost.
- **once_cell / orchestrator export:** public Lazy<Regex> and Export error conversion are source contracts; retain until an intentional API migration. No speculative standard-library rewrite was implemented.
- **SQLite/image/archive:** retain bundled SQLite backup/trace, existing image decoder limits and narrow ZIP codecs. Native SQLite in Rust and Node serves different processes. A newer major is not evidence of benefit; requires archive integrity, import/export, migration/backup and corpus tests.
- **Routine compatible updates:** matrices give exact available targets but recommend the current lock absent a demonstrated benefit. Use focused batches and the same tests; do not combine every compatible release into this branch.
- **postcss override:** keep 8.5.23 until parent-range resolution independently preserves the patched version. Removal requires a lock diff and advisory proof.

## Rerun and ownership

Use [the dependency capture instructions](../../scripts/dependencies/README.md), then the validation commands in [measurements](measurements.md). Root Cargo workspace declarations own shared Rust versions/features; member manifests own local features/targets. pnpm-workspace.yaml owns shared JS catalog versions; package manifests own local declarations; root overrides are explicit policy. scripts/visual retains its npm manifest/lock boundary. CI pins Node/pnpm/tool versions and enforces the existing security policy plus the new full/island npm gates. Update the normalized graphs and the per-declaration inventories together whenever ownership or dependency shape changes.
