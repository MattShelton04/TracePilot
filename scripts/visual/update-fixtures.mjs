// Update-flow fixtures for the visual harness: a newer release is available to
// an installer build. Synthetic versions keep captures independent of the real
// release manifest, which changes with every release.

/** Case fixture that turns on the startup update check and its result. */
export const updateAvailableFixture = "update-available";

const releaseUrl = "https://github.com/MattShelton04/TracePilot/releases/tag/v1.5.0";

/** GitHub release body, as the release workflow copies it from CHANGELOG.md. */
const releaseNotes = `### Added

- **Synthetic timeline lanes** — Compare agents on a shared time axis, with idle gaps collapsed and messages drawn between lanes (#901).
- **Fixture replay** — Step through a synthetic session one event at a time (#902).

### Changed

- **Faster first index** — Build progress appears on the session list while sessions are indexed (#903).

### Fixed

- **Settings layout** — Long descriptions wrap without pushing controls out of view (#904).`;

const updateCheck = {
  currentVersion: "1.4.0",
  latestVersion: "1.5.0",
  hasUpdate: true,
  releaseUrl,
  publishedAt: "2026-03-18T09:00:00Z",
  releaseNotes,
};

/** Served as `/release-manifest.json` to every capture. */
export const releaseManifestFixture = {
  unreleased: { notes: { added: [], changed: [], fixed: [] }, requiresReindex: false },
  versions: [
    {
      version: "1.4.0",
      date: "2026-03-02",
      notes: {
        added: [
          "Synthetic session gallery: Browse fixture sessions by repository, with previews of their latest turn",
        ],
        changed: [
          "Model pricing: Refreshed synthetic model rates, including long-context tiers",
          "Session list: Cards show the model actually in use for running sessions",
        ],
        fixed: ["Explorer: Large files no longer reset the scroll position when they reload"],
      },
      requiresReindex: true,
    },
    {
      version: "1.3.1",
      date: "2026-02-14",
      notes: {
        added: [],
        changed: [],
        fixed: ["Export: Markdown exports keep code fences inside nested lists"],
      },
      requiresReindex: false,
    },
  ],
};

/** Command results for the update fixture, or `undefined` to use the defaults. */
export function updateFixture(cmd, fixture) {
  if (fixture !== updateAvailableFixture) return undefined;
  if (cmd === "check_for_updates") return updateCheck;
  if (cmd === "get_install_type") return "installed";
  return undefined;
}
