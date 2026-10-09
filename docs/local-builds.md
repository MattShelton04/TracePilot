# Local builds, worktrees and disk use

Every checkout or worktree has its own Rust `target/`, so build time and disk
use multiply with the number of parallel agents. This guide covers what the
repository configures to keep that cost down, how to set up a new worktree, and
the optional machine settings that help most on Windows.

## What the repository configures

| Setting | Where | Effect |
| --- | --- | --- |
| `debug = "line-tables-only"` for the dev/test profile and build scripts | `Cargo.toml` | Keeps file:line backtraces and debug assertions; drops full variable/type info that inflated `.pdb` files, rlibs and incremental caches. Build scripts use the same setting so a crate shared by a build script and a test (`filetime`) is not built twice. Set `CARGO_PROFILE_DEV_DEBUG=full` for a debugger session. |
| `rust-lld.exe` linker on Windows | `.cargo/config.toml` | The toolchain's bundled LLD links the many test binaries and the desktop executable far faster, and with much less memory, than MSVC `link.exe`. To compare against MSVC, set `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=link.exe`. |
| `tracepilot-workspace-hack` | `crates/tracepilot-workspace-hack`, `.config/hakari.toml` | Gives every command one dependency feature set (see below). |

Measured on Windows (6-core desktop with other builds running concurrently, so
times are indicative) from an empty `target/`. "Before" is the previous full
debug info and `link.exe`; "after" is everything above, with sccache already
holding the dependencies from another checkout.

| Step | Before | After |
| --- | --- | --- |
| `cargo test --workspace --exclude tracepilot-desktop --no-run` | 17.3 min | 5.2 min |
| then `cargo build -p tracepilot-desktop` | 33.8 min | 27 s |
| one-line edit in `tracepilot-core`, rebuild tests | 211 s | 25 s |
| then rebuild the desktop | 302 s | 11 s |
| revert the edit, rebuild tests | 277 s | 31 s |
| `target/` after these steps and `cargo test -p tracepilot-core` | 23.8 GB | 8.8 GB |

### Workspace-hack

Cargo unifies dependency features only across the packages selected by one
command. `cargo test --workspace`, `cargo test -p <crate>` and the desktop build
(`tauri dev`, `pnpm app:start`) therefore resolved different features for
low-level crates such as `windows`, `log`, `time`, `syn` and `serde`, and Cargo
built and stored a separate copy of everything above them, including the Tauri
stack. The [cargo-hakari](https://docs.rs/cargo-hakari) workspace-hack crate
depends on the union of those features, so the commands share one build.

- After adding, removing or changing a dependency, run
  `cargo hakari generate && cargo hakari manage-deps` and commit the result. CI's
  policy job fails when it is stale.
- Install the version pinned in CI ([pinned CI binaries](testing.md#pinned-ci-binaries))
  from the [guppy releases](https://github.com/guppy-rs/guppy/releases?q=cargo-hakari),
  or with `cargo install cargo-hakari --locked --version <pin>`.
- Never edit the generated section by hand. `.config/hakari.toml` keeps opt-in
  diagnostics features (`tokio-console`, `automation-devtools`) out of the
  unified set so ordinary and release builds do not gain them. As a result
  `cargo hakari verify` reports those all-features builds; that is expected.

## Setting up a worktree

```powershell
git worktree add .agent/worktrees/<slug> -b <type>/<slug> origin/main
cd .agent/worktrees/<slug>
pnpm install --frozen-lockfile --prefer-offline
```

pnpm hard-links packages from its global store, so `node_modules` costs little
disk per worktree as long as the store and the checkout are on the same volume.
The first Rust build compiles every dependency; sccache (below) turns most of
that into cache hits. Stop app instances and Playwright sessions you started
before `git worktree remove`, which deletes the worktree's `target/` with it.

Do not point several checkouts at one shared `CARGO_TARGET_DIR`: builds would
queue on its lock, a rebuild cannot replace a running `target/debug` executable
on Windows, and the automation launcher expects a `target/` per checkout.

## Machine setup (recommended)

These settings live outside the repository and apply to every checkout.

- **sccache** shares compiled third-party crates across all clones and
  worktrees. Install it (`winget install Mozilla.sccache` or
  `cargo install sccache --locked`), then add to the user-level
  `~/.cargo/config.toml`:

  ```toml
  [build]
  rustc-wrapper = "C:\\Users\\<you>\\.cargo\\bin\\sccache.exe"
  ```

  Use an absolute path (copy the executable into `~/.cargo/bin`) so shells that
  started before the PATH change still find it. Raise the 10 GiB default with a
  user environment variable such as `SCCACHE_CACHE_SIZE=30G`. sccache cannot
  cache workspace crates (incremental), proc-macros, build scripts or linking,
  so it shortens the first build of a worktree rather than every rebuild.
  `sccache --show-stats` reports hits.
- **Dev Drive or Defender exclusions.** Real-time scanning of build output slows
  Rust builds noticeably on Windows. A ReFS Dev Drive holding the checkouts,
  `~/.cargo` and the pnpm store scans asynchronously; alternatively exclude
  those folders from real-time protection. Both need an administrator.
- **Parallel builds.** Each Cargo build uses every core by default, and the
  native link steps need several GB of memory. When three or more agents build
  at once on a small machine, setting `CARGO_BUILD_JOBS` (for example to half
  the logical cores) avoids swapping.
- **rust-analyzer** shares the checkout's `target/` lock with agents' builds;
  `"rust-analyzer.cargo.targetDir": true` gives it its own subdirectory at the
  cost of extra disk.

## Housekeeping

Cargo never deletes superseded builds: every dependency bump, feature or profile
change leaves the old artifacts and incremental caches in place, and a
long-lived checkout grows without bound (45 GB was observed). File access times
on Windows are unreliable, so there is no safe "unused for N days" pruning.

- `pwsh -File scripts/clean.ps1` removes only incremental caches and frontend
  `dist/`; compiled dependencies stay valid.
- `pwsh -File scripts/clean.ps1 -Full` (or `cargo clean`) resets `target/`.
  Run it periodically on long-lived checkouts; with sccache the rebuild is
  mostly cache hits.
