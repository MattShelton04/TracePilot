# JavaScript version decisions

This matrix covers all 46 distinct external direct package names in the baseline/current union, including isolated `pngjs` and newly added `lefthook`. Published latest stable/dist-tags were rechecked against the [npm registry](https://registry.npmjs.org/) on 2026-09-27 UTC; each row links its exact primary registry record. “Latest” is publication status, not an instruction to upgrade. Exact current locks are from the remediated `pnpm-lock.yaml` or isolated `package-lock.json`; baseline locks are from the frozen census at `e3ff0935641de98b96da49f9c2c9fb5b83e3cbf1`.

| External package | Baseline lock | Current lock | Latest stable | Reviewed compatible candidate / exact decision | Registry |
| --- | --- | --- | --- | --- | --- |
| `@biomejs/biome` | 2.4.7 | 2.4.7 | `2.5.14` | keep 2.4.7 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/%40biomejs%2Fbiome) |
| `@fontsource-variable/inter` | 5.2.8 | 5.2.8 | `5.3.0` | desktop 5.2.8 retained; redundant root declaration removed; published candidate 5.3.0 | [registry](https://registry.npmjs.org/%40fontsource-variable%2Finter) |
| `@playwright/cli` | 0.1.19 | 0.1.19 | `0.1.21` | keep exact 0.1.19; attachment command contract must be retested | [registry](https://registry.npmjs.org/%40playwright%2Fcli) |
| `@playwright/experimental-ct-vue` | 1.59.1 | 1.59.1 | `1.62.1` | keep 1.59.1 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/%40playwright%2Fexperimental-ct-vue) |
| `@playwright/test` | 1.59.1 | 1.59.1 | `1.63.0` | root exact 1.59.1 retained; redundant UI declaration removed | [registry](https://registry.npmjs.org/%40playwright%2Ftest) |
| `@tailwindcss/vite` | 4.2.1 | 4.2.1 | `4.3.3` | keep 4.2.1 lock; later candidate requires targeted validation; published candidate 4.3.3 | [registry](https://registry.npmjs.org/%40tailwindcss%2Fvite) |
| `@tauri-apps/api` | 2.10.1 | 2.10.1 | `2.12.0` | keep 2.10.1; coordinate 2.x JS/Rust upgrade; published candidate 2.12.0 | [registry](https://registry.npmjs.org/%40tauri-apps%2Fapi) |
| `@tauri-apps/cli` | 2.10.1 | 2.10.1 | `2.12.0` | keep 2.10.1; coordinate 2.x JS/Rust upgrade; published candidate 2.12.0 | [registry](https://registry.npmjs.org/%40tauri-apps%2Fcli) |
| `@tauri-apps/plugin-dialog` | 2.6.0 | 2.6.0 | `2.8.0` | keep 2.6.0; coordinate 2.x JS/Rust upgrade; published candidate 2.8.0 | [registry](https://registry.npmjs.org/%40tauri-apps%2Fplugin-dialog) |
| `@tauri-apps/plugin-log` | 2.8.0 | 2.8.0 | `2.10.0` | keep 2.8.0; coordinate 2.x JS/Rust upgrade; published candidate 2.10.0 | [registry](https://registry.npmjs.org/%40tauri-apps%2Fplugin-log) |
| `@tauri-apps/plugin-notification` | 2.3.3 | 2.3.3 | `2.5.0` | keep 2.3.3; coordinate 2.x JS/Rust upgrade; published candidate 2.5.0 | [registry](https://registry.npmjs.org/%40tauri-apps%2Fplugin-notification) |
| `@tauri-apps/plugin-opener` | 2.5.3 | 2.5.3 | `2.6.0` | keep 2.5.3; coordinate 2.x JS/Rust upgrade; published candidate 2.6.0 | [registry](https://registry.npmjs.org/%40tauri-apps%2Fplugin-opener) |
| `@tauri-apps/plugin-process` | 2.3.1 | 2.3.1 | `2.4.0` | keep 2.3.1; coordinate 2.x JS/Rust upgrade; published candidate 2.4.0 | [registry](https://registry.npmjs.org/%40tauri-apps%2Fplugin-process) |
| `@tauri-apps/plugin-updater` | 2.10.0 | 2.10.0 | `2.13.0` | keep 2.10.0; coordinate signed updater/JS/Rust testing; published candidate 2.13.0 | [registry](https://registry.npmjs.org/%40tauri-apps%2Fplugin-updater) |
| `@types/better-sqlite3` | 7.6.13 | 7.6.13 | `9.6.0` | keep 7.6.13 until CLI typecheck validates removal or major types change | [registry](https://registry.npmjs.org/%40types%2Fbetter-sqlite3) |
| `@types/dompurify` | 3.2.0 | removed | `3.2.0` | removed deprecated type stub | [registry](https://registry.npmjs.org/%40types%2Fdompurify) |
| `@types/markdown-it` | 14.1.2 | 14.1.2 | `14.2.0` | keep 14.1.2 lock; later candidate requires targeted validation; published candidate 14.2.0 | [registry](https://registry.npmjs.org/%40types%2Fmarkdown-it) |
| `@types/node` | 22.19.15 | 22.19.15 | `26.6.3` | keep Node 22 line; do not follow 26 latest; published candidate 22.20.4 | [registry](https://registry.npmjs.org/%40types%2Fnode) |
| `@types/papaparse` | 5.5.2 | 5.5.2 | `5.5.2` | keep 5.5.2 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/%40types%2Fpapaparse) |
| `@vitejs/plugin-vue` | 5.2.4 | 5.2.4 | `6.0.9` | keep 5.2.4 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/%40vitejs%2Fplugin-vue) |
| `@vue/compiler-dom` | 3.5.30 | 3.5.30 | `3.5.43` | keep ^3.5.0 / lock 3.5.30; CT build needs direct UI declaration, then runs 5/6 with baseline-reproduced snapshot mismatch | [registry](https://registry.npmjs.org/%40vue%2Fcompiler-dom) |
| `@vue/test-utils` | 2.4.6 | 2.4.6 | `2.5.1` | keep 2.4.6 lock; later candidate requires targeted validation; published candidate 2.5.1 | [registry](https://registry.npmjs.org/%40vue%2Ftest-utils) |
| `better-sqlite3` | 12.8.0 | 12.8.0 | `13.0.3` | keep 12.8.0; native ABI/SQLite review before major | [registry](https://registry.npmjs.org/better-sqlite3) |
| `chalk` | 5.6.2 | 5.6.2 | `6.0.1` | keep 5.6.2; major CLI/color review later | [registry](https://registry.npmjs.org/chalk) |
| `commander` | 13.1.0 | 13.1.0 | `15.0.0` | keep 13.1.0; major CLI/help migration later | [registry](https://registry.npmjs.org/commander) |
| `dompurify` | 3.4.16 | 3.4.16 | `3.4.16` | keep 3.4.16 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/dompurify) |
| `esbuild` | 0.27.4 | 0.28.2 | `0.28.2` | 0.28.2 advisory patch delivered | [registry](https://registry.npmjs.org/esbuild) |
| `jsdom` | 28.1.0 | 28.1.0 | `30.1.1` | keep 28.1.0; Node 22.12 floor now declared | [registry](https://registry.npmjs.org/jsdom) |
| `lefthook` | — | 2.1.14 | `2.1.14` | 2.1.14 exact developer-tool pin added | [registry](https://registry.npmjs.org/lefthook) |
| `lucide-vue-next` | 1.0.0 | 1.0.0 | `1.0.0` | keep 1.0.0; later migrate to @lucide/vue 1.48.0 with icon VRT | [registry](https://registry.npmjs.org/lucide-vue-next) |
| `markdown-it` | 14.3.0 | 14.3.0 | `15.0.2` | keep 14.3.0 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/markdown-it) |
| `papaparse` | 5.5.4 | 5.5.4 | `5.7.0` | keep 5.5.4 lock; later candidate requires targeted validation; published candidate 5.7.0 | [registry](https://registry.npmjs.org/papaparse) |
| `pinia` | 3.0.4 | 3.0.4 | `4.0.3` | keep 3.0.4 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/pinia) |
| `playwright-core` | 1.58.2 | 1.58.2 | `1.63.0` | keep 1.58.2; align exact version with @playwright/test and recapture browsers later | [registry](https://registry.npmjs.org/playwright-core) |
| `pngjs` | 7.0.0 | 7.0.0 | `7.0.0` | keep 7.0.0 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/pngjs) |
| `rimraf` | 6.1.3 | 6.1.3 | `6.1.3` | keep 6.1.3 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/rimraf) |
| `rollup-plugin-visualizer` | 7.0.1 | 7.0.1 | `7.1.1` | keep 7.0.1 lock; later candidate requires targeted validation; published candidate 7.1.1 | [registry](https://registry.npmjs.org/rollup-plugin-visualizer) |
| `tailwindcss` | 4.2.1 | 4.2.1 | `4.3.3` | keep 4.2.1 lock; later candidate requires targeted validation; published candidate 4.3.3 | [registry](https://registry.npmjs.org/tailwindcss) |
| `tsx` | 4.21.0 | 4.23.15 | `4.23.15` | 4.23.15 resolves patched esbuild line | [registry](https://registry.npmjs.org/tsx) |
| `typescript` | 5.9.3 | 5.9.3 | `7.0.2` | keep 5.9.3; TypeScript 7 migration later | [registry](https://registry.npmjs.org/typescript) |
| `vite` | 6.4.1 | 6.4.3 | `8.3.1` | 6.4.3 advisory patch delivered | [registry](https://registry.npmjs.org/vite) |
| `vitest` | 3.2.4 | 4.1.11 | `5.0.2` | 4.1.11 advisory migration delivered | [registry](https://registry.npmjs.org/vitest) |
| `vue` | 3.5.30 | 3.5.30 | `3.5.43` | keep 3.5.30 lock; later candidate requires targeted validation; published candidate 3.5.43 | [registry](https://registry.npmjs.org/vue) |
| `vue-router` | 4.6.4 | 4.6.4 | `5.3.1` | keep 4.6.4 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/vue-router) |
| `vue-tsc` | 2.2.12 | 2.2.12 | `3.3.11` | keep 2.2.12 lock; later candidate requires targeted validation | [registry](https://registry.npmjs.org/vue-tsc) |
| `yaml` | 2.9.0 | 2.9.0 | `2.9.1` | keep root exact 2.9.0 and CLI compatible range; parser migration later | [registry](https://registry.npmjs.org/yaml) |

The live packument check superseded cached search-result versions in the worker packets: Biome is 2.5.14 rather than 2.5.13, tsx is 4.23.15 rather than 4.23.13, and chalk is 6.0.1 rather than 6.0.0. Eight Tauri JavaScript names also advanced within 2.x; their exact current and published versions appear above. No broader Tauri change is implied by those newer publication records.

The narrow security batch moves Vite from 6.4.1 to 6.4.3, Vitest from 3.2.4 to 4.1.11, direct CLI esbuild from 0.27.4 to 0.28.2, and shared tsx from 4.21.0 to 4.23.15 so its `esbuild ~0.28.0` dependency also resolves to a patched 0.28.2. Vitest 4 keeps Vite 6 compatibility but changes constructor mocks and inferred mock typing; test fixtures were adapted. The declared Node range is now `>=22.12 <23`, matching jsdom 28.1.0’s Node 22 floor; the installed Node 22.19.0 fits it.

A future Vite 8 update crosses into Rolldown, `@vitejs/plugin-vue` major peer constraints, `manualChunks` and optional bundle visualization; it is outside this patch. Tauri JavaScript packages and matching Rust plugins should move together, especially updater/relaunch and Windows WebView flows. Playwright CLI 0.1.19 has a separate attachment contract from Playwright test/core 1.59.1/1.58.2; align only after the pinned automation skill and browser artifacts are validated. Desktop renderer uses DOMPurify with its own types; removing the deprecated `@types/dompurify` stub does not remove sanitization.

Version provenance has two limits: registry metadata is a point-in-time publication check, and a compatible range only indicates resolver admissibility. It does not prove source or peer behavior under a candidate. The lock graph preserves actual peer-qualified contexts and platform optional packages; Windows `pnpm list` paths were checked for existence before calling them locally installed.
