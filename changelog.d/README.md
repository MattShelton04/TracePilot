# Changelog fragments

A change users will notice adds one file here instead of editing
[`CHANGELOG.md`](../CHANGELOG.md), so parallel PRs don't conflict on it.

- Name it after your branch or change: `changelog.d/<slug>.md`.
- Use only Keep a Changelog headings: `### Added`, `### Changed`,
  `### Deprecated`, `### Removed`, `### Fixed`, `### Security`.
- Under each heading, write bullets in CHANGELOG's style:
  `- **Title** — One to three sentences (#PR).` Indent continuation lines by two
  spaces. See [writing the notes](../docs/releasing.md#writing-the-notes).
- Nothing else goes in the file: no title, prose or comments.
- Skip refactors, tests and internal tooling.

```md
### Fixed

- **Search palette** — Results from an earlier query no longer replace those for the current one (#886).
```

`node scripts/release/collect-changelog.mjs --check` validates the fragments.
During [release prep](../docs/releasing.md), `pnpm changelog:collect` merges
them into `## [Unreleased]` and deletes them.
