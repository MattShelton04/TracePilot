# Releasing TracePilot

The canonical steps for preparing a release. An agent asked to "update the
project to vX.Y.Z" (or "prepare release X.Y.Z") follows this guide up to an
open PR; the maintainer merges, tags and publishes.

## What a release PR contains

A release PR (`chore: release vX.Y.Z`) changes only:

- Version metadata from `scripts/bump-version.ps1`: root `Cargo.toml`,
  `Cargo.lock`, and the root and pnpm workspace `package.json` files.
- `CHANGELOG.md`: a new `## [X.Y.Z] - YYYY-MM-DD` section. The release
  workflow publishes this section as the GitHub release body.
- `apps/desktop/public/release-manifest.json`: a new entry at the top of
  `versions`, shown in the app's What's New and update dialogs.

Feature work or fixes found along the way belong in their own PRs.

## Agent steps

1. **Start clean from `main`.** `git checkout main && git pull`, and confirm
   `git status` is clean. The bump script refuses a dirty tree.
2. **Collect the changes.** Find the previous release tag
   (`git tag --sort=-creatordate`, ignoring rehearsal tags such as
   `v0.9.1-1`) and read `git log <prev-tag>..HEAD`, including commit bodies.
   Read the existing `[Unreleased]` notes in both files; PRs often stage
   entries there already.
3. **Branch and bump.**

   ```powershell
   git checkout -b release/vX.Y.Z
   .\scripts\bump-version.ps1 -Version X.Y.Z
   ```

   Requires pnpm and `cargo-edit` (`cargo install cargo-edit`). The script
   prints a short reminder of the remaining steps in this guide.
4. **Write `CHANGELOG.md`.** Insert `## [X.Y.Z] - <today>` directly below
   `## [Unreleased]`, leaving `[Unreleased]` empty. Group entries under
   `### Added`, `### Changed` and `### Fixed` (omit empty groups).
5. **Write the release manifest.** Add a `versions[0]` entry with `version`,
   `date`, `notes.added/changed/fixed` and `requiresReindex`, then reset
   `unreleased` to empty arrays with `requiresReindex: false`. Preserve the
   file's formatting and every older entry.
6. **Validate** (see below), then commit, push and open the PR.

## Writing the notes

Match the style of the previous release in each file.

- **Audience.** Write for users, not reviewers. Lead with the visible effect;
  skip refactors, tests and internal renames.
- **CHANGELOG entries** are `- **Title** — One to three sentences (#PR, #PR).`
  Merge related PRs into one entry. Site, CI and developer-tooling changes may
  get one short entry each (for example "Website" or "Development workflow").
- **Manifest entries** are `"Title: One sentence"` with no trailing period and
  no PR numbers. Use the same titles as the changelog, shorter, and only for
  changes visible in the app (no site, CI or tooling entries). Keep each group
  to about three to seven items.
- **`requiresReindex`** is `true` only when users must trigger a reindex
  themselves; the dialog then prompts for one. Automatic index refreshes on
  launch (an analytics or migration version bump) stay `false` and are
  mentioned in the note text instead.
- **Check facts against the diff.** Model names, prices, CLI versions and
  platform claims come from the commits (for pricing, `docs/pricing-model.md`
  records each snapshot).

## Validation

Run before committing:

```powershell
git diff --stat                   # only the files listed above
node -e "JSON.parse(require('fs').readFileSync('apps/desktop/public/release-manifest.json','utf8'))"
pnpm --filter @tracepilot/desktop exec vitest run releaseNotes WhatsNewModal
cargo check --workspace --quiet
just check-docs                   # when docs changed
```

Also confirm every `version` field in the bumped manifests reads `X.Y.Z`, and
that the CHANGELOG section extracts cleanly (the workflow uses the same awk):

```bash
awk '/^## \[X.Y.Z\]/{found=1; next} /^## \[/{if(found) exit} found{print}' CHANGELOG.md
```

CI on the PR runs the full gates; a release PR needs no app screenshots.

## Commit and PR

```powershell
git add -A
git commit -m "chore: release vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --base main --title "chore: release vX.Y.Z" --body-file <body>
```

The PR body summarizes the bump, the release highlights, the validation run,
and the maintainer's remaining steps below. Do not merge, tag or publish.

## Maintainer steps after the PR

1. Wait for CI to pass, then merge the PR.
2. Tag the merged commit and push the tag:

   ```powershell
   git checkout main
   git pull
   git tag -s vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

3. The [release workflow](../.github/workflows/release.yml) builds the Windows
   installers, the Apple Silicon disk image and `latest.json`, then publishes
   the release. Check the published release and the in-app update.
4. The Site workflow rebuilds the [landing page](landing-page.md) when the
   release workflow succeeds, picking up the new version and installer links.

### Rehearsals

Pushing a numeric prerelease tag such as `vX.Y.Z-1` from a throwaway commit
runs the full release build but stops at a draft, so installers can be tested
before anything is published. Delete the draft release and its tag afterwards
(`gh release delete vX.Y.Z-1 --cleanup-tag`).
