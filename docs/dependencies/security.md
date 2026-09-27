# Dependency security audit

The baseline is commit `e3ff0935641de98b96da49f9c2c9fb5b83e3cbf1`, scanned on 2026-09-27. The candidate was rescanned the same day. A dependency path establishes inclusion in a resolved graph; it does not, by itself, prove that the affected API is called or that a platform-specific branch ships on every platform. The locally generated baseline graph and locally generated final graph preserve the path and edge evidence. Raw reports and command receipts are retained under ignored `.agent/dependency-audit/baseline/` and `.agent/dependency-audit/final/`.

| Baseline scan | Tool, database, and scope | Result |
| --- | --- | --- |
| RustSec | `cargo-audit 0.22.2 audit --json --db .agent/dependency-audit/advisory-db`; advisory DB commit `e2111519ba6d14a5da59a7b2e5c8083ae8a37c01`, updated 2026-09-25 19:51:57 +02:00; all 723 `Cargo.lock` packages | 0 vulnerability entries; 8 unmaintained and 6 unsound **informational warnings**. Zero vulnerabilities does not mean zero warnings. |
| Cargo Deny | `cargo-deny 0.20.2 --locked --format json --metadata-path .agent/dependency-audit/baseline/cargo-metadata.stdout check`; host metadata graph | Exit 7. It reports 11 of the maintenance/unsound notices, 7 first-party missing-license errors, 2 rejected `CDLA-Permissive-2.0` licenses, and 7 first-party wildcard-dependency groups (17 labeled edges). It also emits 8 `unresolved-workspace-dependency` diagnostics with severity `bug`. Its host graph omits Linux-only `event-listener` and `glib`; it is not equivalent to the lock-wide RustSec scan. |
| pnpm full | pnpm 10.32.1 `pnpm audit --json`; entire workspace lock including development and build tools | Exit 1: 32 scanner entries, **27 distinct GHSA IDs** across 9 affected package/version/path groups; 3 low, 14 moderate, 14 high, 1 critical entries. Repeat entries for the two brace-expansion majors and Vitest/mocker are counted once per GHSA ID below. |
| pnpm production | `pnpm audit --prod --json` | Exit 0, no findings. This narrower result does not clear the full workspace toolchain. |
| Visual npm island | npm 11.6.0 `npm audit --prefix scripts/visual --package-lock-only --json` | Exit 0, no findings in the separate `scripts/visual/package-lock.json`. |

| Final scan | Same lockfile scope and database | Result |
| --- | --- | --- |
| RustSec | `cargo-audit 0.22.2 audit --json --no-fetch --db .agent/dependency-audit/advisory-db`; 721 final lock packages. The report omits the revision with `--no-fetch`; the local advisory checkout remained at `e2111519ba6d14a5da59a7b2e5c8083ae8a37c01`. | Exit 0: 0 vulnerabilities, **8 unmaintained and 2 unsound warnings**. Four baseline unsound warning instances cleared; the ten rows marked retained below remain. |
| Cargo Deny | `cargo-deny 0.20.2 --locked --format json --metadata-path .agent/dependency-audit/final/cargo-metadata.stdout check` | Exit 7: 8 advisory errors, 7 wildcard-group errors spanning **16 labeled dependency edges**, and 2 rejected-license errors. Baseline had 7 wildcard groups spanning 17 labeled edges. It separately emits 7 `unresolved-workspace-dependency` diagnostics with severity `bug`. Seven first-party license errors and three host-visible unsound notices cleared. RustSec separately retains Linux-only `glib` and build-time `rand` warnings. |
| pnpm full and production | Pinned pnpm 10.34.5, `pnpm audit --json` and `pnpm audit --prod --json` | Both exit 0 with **0 findings** at all severities. |
| Visual npm island | `npm audit --prefix scripts/visual --package-lock-only --json` | Exit 0 with 0 findings. |

The final lock selects `anyhow 1.0.104`, `event-listener 5.4.2`, and `lru 0.18.5`, clearing four RustSec warning instances. It selects Vite 6.4.3, Vitest and `@vitest/mocker` 4.1.11, brace-expansion 2.1.7 and 5.0.12, picomatch 4.0.7, js-cookie 3.0.8, undici 7.30.0, and esbuild 0.28.2 for the nine pnpm groups; the final full audit reports zero findings. `tsx 4.23.15` also refreshes its build-tool path. The pnpm executable itself is separately pinned to 10.34.5 in the root package, setup action, and CI, addressing [GHSA-vx52-2968-3vc6](https://github.com/advisories/GHSA-vx52-2968-3vc6); `pnpm audit` cannot audit its own executable outside the project lock graph. The root declares Lefthook 2.1.14, blocks its automatic install script, and exposes explicit `pnpm hooks:install` for opt-in hook installation.

## RustSec warning disposition

The table covers all **14 baseline warning instances**, including both distinct `lru` advisories. RustSec classifies these as `unsound` or `unmaintained`, rather than scored vulnerabilities; severity and exploitability are not interchangeable. “Cleared” means the warning no longer appears in the final lock scan. “Retained” means the graph still contains the warning and needs an upstream ecosystem migration or further exposure evidence. No first-party callsite found is narrower than proof that transitive code cannot call an affected API.

| Advisory and baseline package | Class; affected path and exposure | Patched range; final disposition |
| --- | --- | --- |
| [RUSTSEC-2025-0057](https://rustsec.org/advisories/RUSTSEC-2025-0057.html) `fxhash 0.2.1` | Unmaintained; desktop → Tauri utils → kuchikiki/selectors, runtime parsing. No direct first-party API. | No patched release; **retained**, track Tauri/selectors migration. |
| [RUSTSEC-2024-0436](https://rustsec.org/advisories/RUSTSEC-2024-0436.html) `paste 1.0.15` | Unmaintained; desktop → Tauri/Specta derive chain, code-generation macro. | No patched release; **retained**, coordinate Specta stack migration. |
| [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html) `proc-macro-error 1.0.4` | Unmaintained; Linux Tauri → GTK3 macros, build-time only. | No patched release; **retained**, GTK macro migration upstream. |
| [RUSTSEC-2025-0081](https://rustsec.org/advisories/RUSTSEC-2025-0081.html) `unic-char-property 0.9.0` | Unmaintained; desktop → Tauri utils → urlpattern → unic-ucd-ident, URL/capability parsing. | No patched release; **retained**, urlpattern/Tauri migration. |
| [RUSTSEC-2025-0075](https://rustsec.org/advisories/RUSTSEC-2025-0075.html) `unic-char-range 0.9.0` | Unmaintained; same urlpattern/unic-ucd-ident runtime family. | No patched release; **retained**, upstream migration. |
| [RUSTSEC-2025-0080](https://rustsec.org/advisories/RUSTSEC-2025-0080.html) `unic-common 0.9.0` | Unmaintained; urlpattern → unic-ucd-ident → unic-ucd-version. | No patched release; **retained**, upstream migration. |
| [RUSTSEC-2025-0100](https://rustsec.org/advisories/RUSTSEC-2025-0100.html) `unic-ucd-ident 0.9.0` | Unmaintained; Tauri utils → urlpattern runtime parser. | No patched release; **retained**, upstream migration. |
| [RUSTSEC-2025-0098](https://rustsec.org/advisories/RUSTSEC-2025-0098.html) `unic-ucd-version 0.9.0` | Unmaintained; urlpattern → unic-ucd-ident chain. | No patched release; **retained**, upstream migration. |
| [RUSTSEC-2026-0190](https://rustsec.org/advisories/RUSTSEC-2026-0190.html) `anyhow 1.0.102` | Unsound `Error::downcast_mut` after added context; desktop → Tauri normal runtime. No first-party trigger found; transitive callers unproven. | `>=1.0.103`; **cleared** at 1.0.104. Removing a direct declaration alone would leave Tauri's transitive edge. |
| [RUSTSEC-2026-0221](https://rustsec.org/advisories/RUSTSEC-2026-0221.html) `event-listener 5.4.1` | Unsound `!Send` tag crossing threads via `StackSlot`; Linux desktop → tauri-plugin-opener → zbus. zbus uses listeners, but no `listener!`/`with_tag` trigger was found in inspected source. | `>=5.4.2`; **cleared** at 5.4.2. |
| [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) `glib 0.18.5` | Unsound `VariantStrIter`; Linux desktop → Tauri → GTK. No first-party `VariantStrIter` use found; upstream callers unproven. | `>=0.20.0`; **retained** because GTK 0.18 cannot be lock-only upgraded. |
| [RUSTSEC-2026-0002](https://rustsec.org/advisories/RUSTSEC-2026-0002.html) `lru 0.12.5` | Unsound `IterMut`; direct shipped bindings cache. The cache uses `new/get/put/resize`, not `IterMut` in inspected first-party code. | `>=0.16.3`; **cleared** at 0.18.5. |
| [RUSTSEC-2026-0253](https://rustsec.org/advisories/RUSTSEC-2026-0253.html) `lru 0.12.5` | Unsound `LruCache::pop` panic safety; same direct shipped cache. No first-party `pop` call found. | `>=0.18.2`; **cleared** at 0.18.5. |
| [RUSTSEC-2026-0097](https://rustsec.org/advisories/RUSTSEC-2026-0097.html) `rand 0.7.3` | Unsound only under the advisory's logging/thread-RNG preconditions; desktop → Tauri utils → selectors → phf_codegen/phf_generator, a build-time path. The resolved rand node lacks `log`; trigger not demonstrated. | Patched maintained lines include 0.8.6, 0.9.3, 0.10.1; no 0.7 fix. **Retained** pending selectors/PHF migration. |

Seven workspace crates now inherit the workspace license, addressing the seven first-party missing-license errors. This does **not** make `cargo deny` clean: two external `CDLA-Permissive-2.0` packages, webpki-root-certs 1.0.6 and webpki-roots 1.0.6, remain rejected by the current license allowlist, and seven first-party wildcard groups covering 16 internal dependency edges remain (17 edges at baseline). These groups are internal workspace/path declarations and should be resolved as an explicit policy decision rather than hidden with an ignore. The host-graph advisory notices above also remain subject to its configured deny behavior. No advisory ignore was added.

The wildcard count comes from the `wildcard` **error** diagnostics themselves: baseline group sizes 2+1+3+3+2+2+4 = 17, final sizes 2+1+2+3+2+2+4 = 16. Cargo Deny also marks inherited workspace path usages as `unresolved-workspace-dependency` with severity `bug` (8 baseline, 7 final). Those are separate scanner diagnostics, not additional wildcard edges or proof that the inherited dependencies are safe. The matching first-party manifests use `workspace = true`, and the root workspace dependencies have paths without versions. Both scans used saved host metadata via `--metadata-path`; these reports alone do not establish whether that invocation contributes to the resolution failure. Cargo metadata and workspace builds resolve these edges, but the deny result remains incomplete for those usages until the scanner issue or invocation is checked independently.

## JavaScript advisory inventory

Each group is a **baseline resolved version and introducer path**, not a claim that the vulnerable operation is reachable in the shipped desktop. Development-server, test-runner, and CLI build-tool advisories are relevant to developer and CI environments. Group targets are present in the final lockfile and no longer appear in the full audit.

| Group | Baseline path and version | Final lock |
| --- | --- | --- |
| B2 | desktop → `@vue/test-utils` → js-beautify → editorconfig → minimatch → brace-expansion 2.0.2 | 2.1.7 |
| B5 | root → rimraf → glob → minimatch → brace-expansion 5.0.4 | 5.0.12 |
| P | CLI → Vitest → picomatch 4.0.3 | 4.0.7 |
| V | desktop → Vite 6.4.1 | 6.4.3 |
| C | desktop → `@vue/test-utils` → js-beautify → js-cookie 3.0.5 | 3.0.8 |
| E | CLI → esbuild 0.27.4 | 0.28.2 |
| U | desktop → jsdom → undici 7.24.2 | 7.30.0 |
| T | CLI → Vitest 3.2.4 | 4.1.11 |
| M | CLI → Vitest → `@vitest/mocker` 3.2.4 | 4.1.11 |

All 27 distinct baseline GHSA IDs follow. When one ID affected both brace-expansion major paths, the fixed floors are listed for **B2/B5** respectively. The scanner reported 32 entries because five IDs repeated across those paths or the Vitest/mocker pair.

| Advisory | Group; severity | Scanner's fixed floor |
| --- | --- | --- |
| [GHSA-f886-m6hf-6m8v](https://github.com/advisories/GHSA-f886-m6hf-6m8v) | B2/B5; moderate | `>=2.0.3` / `>=5.0.5` |
| [GHSA-jxxr-4gwj-5jf2](https://github.com/advisories/GHSA-jxxr-4gwj-5jf2) | B5; moderate | `>=5.0.6` |
| [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | B2/B5; high | `>=2.1.2` / `>=5.0.7` |
| [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | B2/B5; high | `>=2.1.3` / `>=5.0.8` |
| [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | B2/B5; high | `>=2.1.4` / `>=5.0.9` |
| [GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p) | P; moderate | `>=4.0.4` |
| [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) | P; high | `>=4.0.4` |
| [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) | V; moderate | `>=6.4.2` |
| [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583) | V; high | `>=6.4.2` |
| [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) | V; moderate | `>=6.4.3` |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | V; high | `>=6.4.3` |
| [GHSA-qjx8-664m-686j](https://github.com/advisories/GHSA-qjx8-664m-686j) | C; high | `>=3.0.7` |
| [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) | E; low | `>=0.28.1` |
| [GHSA-vmh5-mc38-953g](https://github.com/advisories/GHSA-vmh5-mc38-953g) | U; high | `>=7.28.0` |
| [GHSA-p88m-4jfj-68fv](https://github.com/advisories/GHSA-p88m-4jfj-68fv) | U; moderate | `>=7.28.0` |
| [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) | U; high | `>=7.28.0` |
| [GHSA-hm92-r4w5-c3mj](https://github.com/advisories/GHSA-hm92-r4w5-c3mj) | U; high | `>=7.28.0` |
| [GHSA-g8m3-5g58-fq7m](https://github.com/advisories/GHSA-g8m3-5g58-fq7m) | U; low | `>=7.28.0` |
| [GHSA-pr7r-676h-xcf6](https://github.com/advisories/GHSA-pr7r-676h-xcf6) | U; moderate | `>=7.28.0` |
| [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) | U; moderate | `>=7.29.0` |
| [GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272) | U; high | `>=7.29.0` |
| [GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) | U; moderate | `>=7.29.0` |
| [GHSA-jr45-8vmc-qm54](https://github.com/advisories/GHSA-jr45-8vmc-qm54) | U; moderate | `>=7.29.0` |
| [GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) | U; moderate | `>=7.29.0` |
| [GHSA-35p6-xmwp-9g52](https://github.com/advisories/GHSA-35p6-xmwp-9g52) | U; low | `>=7.28.0` |
| [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) | T; critical | `>=3.2.6` |
| [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) | T/M; moderate | `>=4.1.11` for both packages; the 3.x line is not receiving this fix |

The full audit's `devDependencies: 0` metadata is not a reliable production classification for this pnpm workspace: paths such as `apps__cli>vitest`, root rimraf, and desktop jsdom identify tool/test scopes. The critical Vitest finding applies to a test server; the separate mocker advisory describes an unauthenticated HMR socket when its public plugin is exposed, while normal Vitest browser mode uses an authenticated RPC. These preconditions temper exposure, but do not justify retaining a vulnerable development tool. There is no evidence here that these server endpoints are exposed in the shipped Tauri application.

## Gates and final reconciliation

The security CI job keeps the production audit and adds a full workspace audit and an isolated npm lock audit, all with `--audit-level=high` and no ignores:

```sh
pnpm audit --prod --audit-level=high
pnpm audit --audit-level=high
npm audit --prefix scripts/visual --package-lock-only --audit-level=high
```

The saved `.agent/dependency-audit/final/` scan receipts record command, UTC time, and exit code; the local RustSec advisory checkout revision is given above. The final reports support **zero pnpm/npm findings and zero RustSec vulnerability entries**, with ten RustSec informational warnings retained. `cargo deny` still needs separate license and internal-wildcard policy work; a clean RustSec vulnerability count or passing CI audit does not clear those deny errors. Scanner report presence is not a cryptographic binding to lockfile bytes, so repeat these commands against the released lockfiles for future releases. No security advisory was ignored or suppressed for this update.
