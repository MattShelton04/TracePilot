# @tracepilot/config

Shared TypeScript compiler configuration presets for the TracePilot workspace.
No runtime code — just `tsconfig` base files that other packages extend.

## Public "API"

| File                      | Purpose                                                  |
| ------------------------- | -------------------------------------------------------- |
| `typescript/base.json`    | Base `tsconfig` (strict mode, ES2022, `bundler` resolve) |

## Usage

From a consuming workspace package:

```jsonc
// packages/<name>/tsconfig.json
{
  "extends": "@tracepilot/config/typescript/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

The package is `private: true` and has no `main` / `exports` — consumers
reference JSON files by path.

## Workspace dependencies

None. This package is intentionally leaf-level.

## Layout

- `package.json` — metadata only.
- `typescript/base.json` — shared compiler options. All strictness flags and
  module-resolution settings live here; per-package `tsconfig.json` files
  should only override `outDir`, `rootDir`, `include`, and references.

## Related

See ADR [0001 — Tauri + Vue + Rust workspace](../../docs/adr/0001-tauri-vue-rust-workspace.md)
for the overall monorepo layout this config is scoped to.

> Future improvement: the `tech-debt-master-plan-2026-04.md` w129 entry
> tracks a decision on whether to keep a single `base.json` or split into
> `base`, `library`, and `app` variants. Revisit before expanding this folder.
