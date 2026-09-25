# Indexing Loading Screen — Design History

This page records the outcome of an early loading-screen exploration. The
original proposal described eleven concepts (A–K), but their named HTML
prototypes are not present in the repository. The app adopted an orbital
variant of concept G. The old setup flow, event payload sketches, and timing
estimates are superseded by the implementation.

## Current implementation

- [`App.vue`](../apps/desktop/src/App.vue) mounts
  [`IndexingLoadingScreen.vue`](../apps/desktop/src/components/IndexingLoadingScreen.vue)
  during bootstrap indexing.
- [`IndexingOrbitalScene.vue`](../apps/desktop/src/components/indexing/IndexingOrbitalScene.vue)
  renders the visual scene; the host and its composables own progress events,
  reduced-motion handling, completion, and timeout behavior.
- The Settings full rebuild uses its own progress display in
  [`SettingsDataStorage.vue`](../apps/desktop/src/components/settings/SettingsDataStorage.vue).
  Reusing the bootstrap scene there was suggested in the original proposal,
  but has not been implemented or accepted as a requirement.

## Open design question

The [UI audit](../design-system/audit/UI-AUDIT.md) questions whether the
orbital scene's decorative motion fits the current quieter design direction.
That remains a design review item. Use the current components and
[measured performance evidence](reports/performance-mission.md) when changing
loading behavior; the original prototype descriptions are recoverable from
Git history.
