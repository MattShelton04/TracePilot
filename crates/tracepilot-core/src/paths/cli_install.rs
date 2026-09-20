//! Where an installed Copilot CLI keeps the assets it ships with.
//!
//! The CLI resolves its built-in skills and agent definitions relative to the
//! directory that holds its JavaScript bundle, so their location depends on how
//! the CLI was installed:
//!
//! - WinGet, the Homebrew cask, the `gh.io/copilot-install` script and the
//!   downloadable executables all ship one self-extracting binary that unpacks
//!   into the OS cache's `copilot/pkg/<target>/<version>/`. Older builds used
//!   `<COPILOT_HOME>/pkg`, including `pkg/universal/<version>`.
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

mod external;

use external::external_dist_roots;
pub use external::{executable_dist_dirs, node_global_package_dirs};

use std::path::{Path, PathBuf};

use super::{COPILOT_DEFINITIONS_DIR, SKILLS_DIR_NAME, path_is_allowed_by_isolation};

/// Overrides `~/.copilot` for the CLI, and therefore for personal skills,
/// agents and settings.
pub const COPILOT_HOME_ENV: &str = "COPILOT_HOME";
/// Overrides the directory the CLI loads its own bundle (and built-ins) from.
pub const COPILOT_CLI_DIST_DIR_ENV: &str = "COPILOT_CLI_DIST_DIR";
pub const COPILOT_PKG_CACHE_HOME_ENV: &str = "COPILOT_PKG_CACHE_HOME";
pub const COPILOT_CACHE_HOME_ENV: &str = "COPILOT_CACHE_HOME";
/// Extra personal skill directories, separated like `PATH`.
pub const COPILOT_SKILLS_DIRS_ENV: &str = "COPILOT_SKILLS_DIRS";

/// The CLI's second personal root, alongside `<COPILOT_HOME>`.
pub const AGENTS_HOME_DIR_NAME: &str = ".agents";

/// Built-in skill directory names, newest spelling first.
const BUILTIN_SKILL_DIR_NAMES: [&str; 2] = ["builtin-skills", "builtin"];

/// How a distribution root was found. Reported so a support conversation can
/// tell "no CLI installed" apart from "installed somewhere we only guessed".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DistSource {
    /// Named by [`COPILOT_CLI_DIST_DIR_ENV`].
    Env,
    /// Extracted under `<COPILOT_HOME>/pkg`.
    CopilotPackages,
    /// Extracted into the OS cache or an explicit package-cache location.
    PackageCache,
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
            .find(|dir| path_is_allowed_by_isolation(dir) && dir.is_dir())
    }

    /// `definitions/`, which holds the built-in `*.agent.yaml` files.
    pub fn definitions_dir(&self) -> Option<PathBuf> {
        let dir = self.path.join(COPILOT_DEFINITIONS_DIR);
        (path_is_allowed_by_isolation(&dir) && dir.is_dir()).then_some(dir)
    }

    fn has_assets(&self) -> bool {
        self.builtin_skills_dir().is_some() || self.definitions_dir().is_some()
    }

    /// Extracted packages advertise completeness; npm and explicit bundle
    /// directories do not use the self-extractor's marker.
    pub fn is_complete(&self) -> bool {
        !matches!(
            self.source,
            DistSource::CopilotPackages | DistSource::PackageCache
        ) || self.path.join(".extraction-complete").is_file()
    }
}

/// Roots supplying the running CLI's built-ins. A usable explicit override
/// replaces the inventory, including skills absent from the override. Keep the
/// full inventory separately for read-only checks on inactive installations.
pub fn effective_dist_roots(roots: &[DistRoot]) -> impl Iterator<Item = &DistRoot> {
    let overridden = roots.iter().any(|root| root.source == DistSource::Env);
    roots
        .iter()
        .filter(move |root| !overridden || root.source == DistSource::Env)
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
        .filter(|path| !path.as_os_str().is_empty() && path_is_allowed_by_isolation(path))
        .collect()
}

/// `~/.agents/skills`, the CLI's second personal skills root.
pub fn agents_home_skills_dir(user_home: &Path) -> PathBuf {
    user_home.join(AGENTS_HOME_DIR_NAME).join(SKILLS_DIR_NAME)
}

/// Every distribution root that looks like an installed Copilot CLI, most
/// authoritative first and de-duplicated by path.
///
/// Includes both current and legacy package locations: an old home cache must
/// not hide an updated installation in the OS cache. Isolation limits every
/// candidate to its boundary and disables machine-wide package-manager scans.
pub fn dist_roots(copilot_home: &Path) -> Vec<DistRoot> {
    let mut roots = Vec::new();
    if let Some(dir) = env_path(COPILOT_CLI_DIST_DIR_ENV)
        && path_is_allowed_by_isolation(&dir)
    {
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
    for cache in package_cache_dirs() {
        for mut root in package_dist_roots(&cache) {
            root.source = DistSource::PackageCache;
            push_root(&mut roots, root);
        }
    }
    if matches!(super::isolated_data_root(), Ok(None)) {
        for root in external_dist_roots() {
            push_root(&mut roots, root);
        }
    }
    roots
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Self-extractor caches in CLI search order, excluding the legacy home tree.
/// The XDG fallback is searched on every platform, as it is by the CLI loader.
fn package_cache_dirs() -> Vec<PathBuf> {
    let home = crate::utils::home_dir_opt();
    let xdg = env_path("XDG_CACHE_HOME").or_else(|| home.as_ref().map(|home| home.join(".cache")));
    let platform = if cfg!(windows) {
        env_path("LOCALAPPDATA")
            .or_else(|| home.as_ref().map(|home| home.join(".cache")))
            .map(|base| base.join("copilot"))
    } else if cfg!(target_os = "macos") {
        home.as_ref()
            .map(|home| home.join("Library/Caches/copilot"))
    } else {
        xdg.as_ref().map(|base| base.join("copilot"))
    };
    [
        env_path(COPILOT_PKG_CACHE_HOME_ENV),
        env_path(COPILOT_CACHE_HOME_ENV),
        platform,
        xdg.map(|base| base.join("copilot")),
    ]
    .into_iter()
    .flatten()
    .map(|base| base.join("pkg"))
    .filter(|path| path_is_allowed_by_isolation(path))
    .collect()
}

/// Distribution roots under a `<COPILOT_HOME>/pkg` directory, across every
/// platform target (`win32-x64`, the legacy `universal`, …) and version.
///
/// An unreadable `pkg` yields an empty list rather than an error: a broken
/// package directory must not hide the user's own skills and agents.
pub fn package_dist_roots(pkg_dir: &Path) -> Vec<DistRoot> {
    if !path_is_allowed_by_isolation(pkg_dir) {
        return Vec::new();
    }
    let Ok(targets) = std::fs::read_dir(pkg_dir) else {
        return Vec::new();
    };
    let mut roots = Vec::new();
    for target in targets.flatten() {
        let target_path = target.path();
        // `pkg/tmp` is the CLI's staging area for a partly downloaded update.
        if !path_is_allowed_by_isolation(&target_path)
            || !target_path.is_dir()
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
            if !path_is_allowed_by_isolation(&path) || !path.is_dir() {
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

/// The `version` field of a bundle's `package.json`, when there is one.
fn package_version(dist_dir: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(dist_dir.join("package.json")).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn push_root(roots: &mut Vec<DistRoot>, root: DistRoot) {
    if path_is_allowed_by_isolation(&root.path)
        && root.has_assets()
        && !roots
            .iter()
            .any(|existing| same_path(&existing.path, &root.path))
    {
        roots.push(root);
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    a == b || matches!((a.canonicalize(), b.canonicalize()), (Ok(a), Ok(b)) if a == b)
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
    fn package_roots_skip_assetless_directories() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join(".copilot");
        write_dist(&home.join("pkg").join("win32-x64").join("1.2.0"), "builtin");
        // No assets: present on disk but not a usable distribution.
        std::fs::create_dir_all(home.join("pkg").join("linux-x64").join("1.3.0")).unwrap();

        let roots = package_dist_roots(&home.join("pkg"));

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
