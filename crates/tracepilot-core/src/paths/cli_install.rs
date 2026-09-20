//! Where an installed Copilot CLI keeps the assets it ships with.
//!
//! The CLI resolves its built-in skills and agent definitions relative to the
//! directory that holds its JavaScript bundle, so their location depends on how
//! the CLI was installed:
//!
//! - WinGet, the Homebrew cask, the `gh.io/copilot-install` script and the
//!   downloadable executables all ship one self-extracting binary that unpacks
//!   into `<COPILOT_HOME>/pkg/<target>/<version>/` (older builds used
//!   `pkg/universal/<version>`). This is the only layout TracePilot used to know.
//! - `npm install -g @github/copilot` leaves the package in the Node global
//!   root instead: `<prefix>/node_modules/@github/copilot` on Windows and
//!   `<prefix>/lib/node_modules/@github/copilot` elsewhere. nvm, Volta, pnpm,
//!   Bun and Homebrew's Node each put that prefix somewhere different.
//! - `COPILOT_CLI_DIST_DIR` overrides the bundle directory outright.
//!
//! Inside a distribution root the assets sit in `builtin-skills/` (`builtin/`
//! before 1.0.83) and `definitions/`. A root that has neither is not a CLI
//! distribution and is dropped, so a missing or half-written installation
//! costs the caller nothing but a shorter list.

use std::path::{Path, PathBuf};

use super::{COPILOT_DEFINITIONS_DIR, SKILLS_DIR_NAME};

/// Overrides `~/.copilot` for the CLI, and therefore for personal skills,
/// agents and settings.
pub const COPILOT_HOME_ENV: &str = "COPILOT_HOME";
/// Overrides the directory the CLI loads its own bundle (and built-ins) from.
pub const COPILOT_CLI_DIST_DIR_ENV: &str = "COPILOT_CLI_DIST_DIR";
/// Extra personal skill directories, separated like `PATH`.
pub const COPILOT_SKILLS_DIRS_ENV: &str = "COPILOT_SKILLS_DIRS";

/// The CLI's second personal root, alongside `<COPILOT_HOME>`.
pub const AGENTS_HOME_DIR_NAME: &str = ".agents";

/// Built-in skill directory names, newest spelling first.
const BUILTIN_SKILL_DIR_NAMES: [&str; 2] = ["builtin-skills", "builtin"];

/// The npm package that every installation method ultimately unpacks.
const COPILOT_NPM_SCOPE: &str = "@github";
const COPILOT_NPM_PACKAGE: &str = "copilot";
const NODE_MODULES_DIR: &str = "node_modules";

/// How a distribution root was found. Reported so a support conversation can
/// tell "no CLI installed" apart from "installed somewhere we only guessed".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DistSource {
    /// Named by [`COPILOT_CLI_DIST_DIR_ENV`].
    Env,
    /// Extracted under `<COPILOT_HOME>/pkg`.
    CopilotPackages,
    /// An `npm install -g` (or pnpm/Bun/Volta equivalent) package directory.
    NodeModules,
    /// Found by following the `copilot` executable on `PATH`.
    Executable,
}

/// One directory holding a Copilot CLI bundle's shipped assets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DistRoot {
    pub path: PathBuf,
    /// The CLI version, when the layout states it. Kept as text because only
    /// callers that rank roots need to parse it.
    pub version: Option<String>,
    pub source: DistSource,
}

impl DistRoot {
    /// `builtin-skills/`, or the pre-1.0.83 `builtin/`.
    pub fn builtin_skills_dir(&self) -> Option<PathBuf> {
        BUILTIN_SKILL_DIR_NAMES
            .iter()
            .map(|name| self.path.join(name))
            .find(|dir| dir.is_dir())
    }

    /// `definitions/`, which holds the built-in `*.agent.yaml` files.
    pub fn definitions_dir(&self) -> Option<PathBuf> {
        let dir = self.path.join(COPILOT_DEFINITIONS_DIR);
        dir.is_dir().then_some(dir)
    }

    fn has_assets(&self) -> bool {
        self.builtin_skills_dir().is_some() || self.definitions_dir().is_some()
    }
}

/// The CLI home the CLI itself would use, honouring [`COPILOT_HOME_ENV`].
///
/// TracePilot's own configured path still wins where one is available; this is
/// the fallback that used to be hard-coded to `~/.copilot`.
pub fn copilot_home_override() -> Option<PathBuf> {
    let raw = std::env::var_os(COPILOT_HOME_ENV)?;
    let path = PathBuf::from(raw);
    (!path.as_os_str().is_empty()).then_some(path)
}

/// Extra personal skill directories from [`COPILOT_SKILLS_DIRS_ENV`].
pub fn extra_skill_dirs() -> Vec<PathBuf> {
    let Some(raw) = std::env::var_os(COPILOT_SKILLS_DIRS_ENV) else {
        return Vec::new();
    };
    std::env::split_paths(&raw)
        .filter(|path| !path.as_os_str().is_empty())
        .collect()
}

/// `~/.agents/skills`, the CLI's second personal skills root.
pub fn agents_home_skills_dir(user_home: &Path) -> PathBuf {
    user_home.join(AGENTS_HOME_DIR_NAME).join(SKILLS_DIR_NAME)
}

/// Every distribution root that looks like an installed Copilot CLI, most
/// authoritative first and de-duplicated by path.
///
/// `<COPILOT_HOME>/pkg` is preferred because a running CLI keeps it current.
/// The wider search only runs when that yields nothing, so the usual
/// installation never pays for it — and a test fixture with its own `pkg`
/// never reaches the machine's real installation.
pub fn dist_roots(copilot_home: &Path) -> Vec<DistRoot> {
    let mut roots = Vec::new();
    if let Some(dir) = std::env::var_os(COPILOT_CLI_DIST_DIR_ENV).map(PathBuf::from) {
        push_root(
            &mut roots,
            DistRoot {
                version: package_version(&dir),
                path: dir,
                source: DistSource::Env,
            },
        );
    }
    for root in package_dist_roots(&super::CopilotPaths::from_home(copilot_home).pkg_dir()) {
        push_root(&mut roots, root);
    }
    if roots.is_empty() {
        for root in external_dist_roots() {
            push_root(&mut roots, root);
        }
    }
    roots
}

/// Distribution roots under a `<COPILOT_HOME>/pkg` directory, across every
/// platform target (`win32-x64`, the legacy `universal`, …) and version.
///
/// An unreadable `pkg` yields an empty list rather than an error: a broken
/// package directory must not hide the user's own skills and agents.
pub fn package_dist_roots(pkg_dir: &Path) -> Vec<DistRoot> {
    let Ok(targets) = std::fs::read_dir(pkg_dir) else {
        return Vec::new();
    };
    let mut roots = Vec::new();
    for target in targets.flatten() {
        let target_path = target.path();
        // `pkg/tmp` is the CLI's staging area for a partly downloaded update.
        if !target_path.is_dir()
            || target
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case("tmp")
        {
            continue;
        }
        let Ok(versions) = std::fs::read_dir(&target_path) else {
            continue;
        };
        for version in versions.flatten() {
            let path = version.path();
            if !path.is_dir() {
                continue;
            }
            roots.push(DistRoot {
                version: Some(version.file_name().to_string_lossy().to_string()),
                path,
                source: DistSource::CopilotPackages,
            });
        }
    }
    roots.sort_by(|a, b| a.path.cmp(&b.path));
    roots.retain(DistRoot::has_assets);
    roots
}

/// Installations outside `<COPILOT_HOME>`: Node global roots, then whatever
/// the `copilot` executable on `PATH` resolves to.
fn external_dist_roots() -> Vec<DistRoot> {
    let mut roots: Vec<DistRoot> = node_global_package_dirs()
        .into_iter()
        .map(|path| DistRoot {
            version: package_version(&path),
            path,
            source: DistSource::NodeModules,
        })
        .chain(executable_dist_dirs().into_iter().map(|path| DistRoot {
            version: package_version(&path),
            path,
            source: DistSource::Executable,
        }))
        .collect();
    roots.retain(DistRoot::has_assets);
    roots
}

/// Candidate `@github/copilot` package directories across the Node package
/// managers that install a global CLI.
pub fn node_global_package_dirs() -> Vec<PathBuf> {
    let mut module_roots: Vec<PathBuf> = Vec::new();
    let mut add = |dir: PathBuf| module_roots.push(dir);

    // An explicit prefix beats every guess below it.
    for key in ["npm_config_prefix", "NPM_CONFIG_PREFIX", "PREFIX"] {
        if let Some(prefix) = std::env::var_os(key).map(PathBuf::from) {
            add(prefix.join(NODE_MODULES_DIR));
            add(prefix.join("lib").join(NODE_MODULES_DIR));
        }
    }
    // `nvm use` exports the active version's bin directory.
    if let Some(bin) = std::env::var_os("NVM_BIN").map(PathBuf::from)
        && let Some(prefix) = bin.parent()
    {
        add(prefix.join("lib").join(NODE_MODULES_DIR));
    }

    if cfg!(windows) {
        for key in ["APPDATA", "ProgramFiles", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(key).map(PathBuf::from) {
                add(base.join("npm").join(NODE_MODULES_DIR));
                add(base.join("nodejs").join(NODE_MODULES_DIR));
            }
        }
    } else {
        for prefix in [
            "/usr/local",
            "/usr",
            "/opt/homebrew",
            "/home/linuxbrew/.linuxbrew",
        ] {
            add(Path::new(prefix).join("lib").join(NODE_MODULES_DIR));
        }
    }

    if let Some(home) = crate::utils::home_dir_opt() {
        // The install script's non-root default, plus the common npm prefixes.
        for relative in [".local/lib", ".npm-global/lib", ".npm-packages/lib", "lib"] {
            add(home.join(relative).join(NODE_MODULES_DIR));
        }
        add(home.join(".bun/install/global").join(NODE_MODULES_DIR));
        add(home
            .join(".volta/tools/image/packages")
            .join(COPILOT_NPM_SCOPE)
            .join(COPILOT_NPM_PACKAGE)
            .join("lib")
            .join(NODE_MODULES_DIR));
        // Version-managed and store-based layouts keep one directory per
        // toolchain, so the immediate children are scanned rather than guessed.
        for (base, tail) in [
            (
                home.join(".nvm/versions/node"),
                vec!["lib", NODE_MODULES_DIR],
            ),
            (
                home.join(".fnm/node-versions"),
                vec!["installation", "lib", NODE_MODULES_DIR],
            ),
            (
                home.join(".local/share/fnm/node-versions"),
                vec!["installation", "lib", NODE_MODULES_DIR],
            ),
            (
                home.join(".local/share/pnpm/global"),
                vec![NODE_MODULES_DIR],
            ),
            (
                home.join("AppData/Local/pnpm/global"),
                vec![NODE_MODULES_DIR],
            ),
        ] {
            for child in child_dirs(&base) {
                add(tail.iter().fold(child, |path, part| path.join(part)));
            }
        }
    }

    let mut packages: Vec<PathBuf> = module_roots
        .into_iter()
        .map(|root| root.join(COPILOT_NPM_SCOPE).join(COPILOT_NPM_PACKAGE))
        .filter(|package| package.is_dir())
        .collect();
    packages.sort();
    packages.dedup();
    packages
}

/// Directories that could hold the bundle of the `copilot` executable found on
/// `PATH`, after following the symlinks package managers leave in `bin`.
pub fn executable_dist_dirs() -> Vec<PathBuf> {
    let Some(executable) = which_copilot() else {
        return Vec::new();
    };
    let resolved = executable
        .canonicalize()
        .unwrap_or_else(|_| executable.clone());
    let Some(bin_dir) = resolved.parent() else {
        return Vec::new();
    };
    let mut candidates = vec![bin_dir.to_path_buf()];
    if let Some(prefix) = bin_dir.parent() {
        // Homebrew's `libexec`, and the npm shim's sibling package.
        candidates.push(prefix.join("libexec"));
        candidates.push(
            prefix
                .join("lib")
                .join(NODE_MODULES_DIR)
                .join(COPILOT_NPM_SCOPE)
                .join(COPILOT_NPM_PACKAGE),
        );
        candidates.push(
            prefix
                .join(NODE_MODULES_DIR)
                .join(COPILOT_NPM_SCOPE)
                .join(COPILOT_NPM_PACKAGE),
        );
    }
    candidates.retain(|dir| dir.is_dir());
    candidates.dedup();
    candidates
}

/// The first `copilot` executable on `PATH`.
fn which_copilot() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let names: &[&str] = if cfg!(windows) {
        &["copilot.exe", "copilot.cmd", "copilot"]
    } else {
        &["copilot"]
    };
    std::env::split_paths(&path).find_map(|dir| {
        names
            .iter()
            .map(|name| dir.join(name))
            .find(|candidate| candidate.is_file())
    })
}

/// The `version` field of a bundle's `package.json`, when there is one.
fn package_version(dist_dir: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(dist_dir.join("package.json")).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn child_dirs(base: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(base) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    dirs
}

fn push_root(roots: &mut Vec<DistRoot>, root: DistRoot) {
    if root.has_assets() && !roots.iter().any(|existing| existing.path == root.path) {
        roots.push(root);
    }
}

/// `true` when `path` sits inside a directory the CLI installed itself into.
pub fn is_within_dist_root(roots: &[DistRoot], path: &Path) -> bool {
    let canonical = path.canonicalize();
    roots.iter().any(|root| {
        let root_canonical = root.path.canonicalize();
        path.starts_with(&root.path)
            || match (&canonical, &root_canonical) {
                (Ok(path), Ok(root)) => path.starts_with(root),
                _ => false,
            }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_dist(root: &Path, builtin_dir: &str) {
        std::fs::create_dir_all(root.join(builtin_dir).join("demo")).unwrap();
        std::fs::write(
            root.join(builtin_dir).join("demo").join("SKILL.md"),
            "---\nname: demo\ndescription: d\n---\n",
        )
        .unwrap();
    }

    #[test]
    fn package_roots_cover_every_target_and_version() {
        let dir = tempfile::tempdir().unwrap();
        let pkg = dir.path().join("pkg");
        write_dist(&pkg.join("win32-x64").join("1.2.0"), "builtin-skills");
        write_dist(&pkg.join("universal").join("1.1.0"), "builtin");
        write_dist(&pkg.join("tmp").join("9.9.9"), "builtin");
        std::fs::create_dir_all(pkg.join("win32-x64").join("1.0.0")).unwrap();

        let roots = package_dist_roots(&pkg);

        let versions: Vec<_> = roots.iter().filter_map(|r| r.version.clone()).collect();
        assert_eq!(versions, vec!["1.1.0", "1.2.0"]);
        assert!(
            roots
                .iter()
                .all(|r| r.source == DistSource::CopilotPackages)
        );
        assert!(roots[1].builtin_skills_dir().is_some());
    }

    #[test]
    fn package_roots_are_empty_when_pkg_is_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        let pkg = dir.path().join("pkg");
        // A file where the directory is expected: the CLI's download left over.
        std::fs::write(&pkg, "not a directory").unwrap();

        assert!(package_dist_roots(&pkg).is_empty());
    }

    #[test]
    fn builtin_dir_prefers_the_current_spelling() {
        let dir = tempfile::tempdir().unwrap();
        write_dist(dir.path(), "builtin");
        write_dist(dir.path(), "builtin-skills");
        let root = DistRoot {
            path: dir.path().to_path_buf(),
            version: None,
            source: DistSource::Env,
        };

        assert_eq!(
            root.builtin_skills_dir(),
            Some(dir.path().join("builtin-skills"))
        );
    }

    #[test]
    fn definitions_dir_is_reported_only_when_present() {
        let dir = tempfile::tempdir().unwrap();
        let root = DistRoot {
            path: dir.path().to_path_buf(),
            version: None,
            source: DistSource::Env,
        };
        assert!(root.definitions_dir().is_none());

        std::fs::create_dir_all(dir.path().join("definitions")).unwrap();
        assert!(root.definitions_dir().is_some());
    }

    #[test]
    fn package_version_is_read_from_the_bundle_manifest() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("package.json"),
            r#"{"name":"@github/copilot","version":"1.0.86"}"#,
        )
        .unwrap();

        assert_eq!(package_version(dir.path()).as_deref(), Some("1.0.86"));
        assert_eq!(package_version(&dir.path().join("missing")), None);
    }

    #[test]
    fn dist_roots_prefer_packages_and_skip_assetless_directories() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join(".copilot");
        write_dist(&home.join("pkg").join("win32-x64").join("1.2.0"), "builtin");
        // No assets: present on disk but not a usable distribution.
        std::fs::create_dir_all(home.join("pkg").join("linux-x64").join("1.3.0")).unwrap();

        let roots = dist_roots(&home);

        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].version.as_deref(), Some("1.2.0"));
    }

    #[test]
    fn personal_roots_follow_the_cli_spelling() {
        let home = Path::new("/home/alice");
        assert_eq!(
            agents_home_skills_dir(home),
            Path::new("/home/alice/.agents/skills")
        );
    }
}
