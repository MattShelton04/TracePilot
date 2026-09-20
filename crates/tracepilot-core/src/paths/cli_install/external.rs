//! Locate Copilot CLI bundles installed by Node package managers or on PATH.

use std::path::{Path, PathBuf};

use super::{DistRoot, DistSource, package_version};

/// The npm package that every installation method ultimately unpacks.
const COPILOT_NPM_SCOPE: &str = "@github";
const COPILOT_NPM_PACKAGE: &str = "copilot";
const NODE_MODULES_DIR: &str = "node_modules";

/// Installations outside `<COPILOT_HOME>`: Node global roots, then whatever
/// the `copilot` executable on `PATH` resolves to.
pub(super) fn external_dist_roots() -> Vec<DistRoot> {
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
    let mut candidates = vec![
        bin_dir.to_path_buf(),
        // Windows npm puts the shim directly in its prefix, without `bin/`.
        bin_dir
            .join(NODE_MODULES_DIR)
            .join(COPILOT_NPM_SCOPE)
            .join(COPILOT_NPM_PACKAGE),
    ];
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
