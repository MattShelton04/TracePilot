# Residual risks and follow-up validation

- Run the packaged Tauri application on Windows, macOS, and Linux for native dialogs, filesystem permissions, Git/worktree subprocesses, updater/window behaviour, SDK lifecycle, and WebView-specific rendering.
- Review visual artifacts for intentional design changes before making the visual workflow a required branch-protection check. Browser and font versions are controlled in CI, but native WebViews can still rasterise differently.
- Automated Axe checks target serious/critical findings; periodic NVDA, VoiceOver, high-contrast, zoom, and reduced-motion reviews remain appropriate.
- Deterministic IPC captures primarily exercise empty/stable states. Add feature-owned populated/error fixtures as those screens evolve, while keeping command fixtures typed and versioned.
- Route-to-file mapping deliberately falls back to all routes when dependency impact is ambiguous. This costs CI time but avoids a false sense of path-scoped coverage.
