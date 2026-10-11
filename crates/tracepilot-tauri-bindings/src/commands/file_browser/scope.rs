//! What the session file browser may show: one session directory
//! (Copilot), or several sibling directories shown as top-level folders
//! (Claude Code's `subagents/` and `tool-results/`).

use std::path::{Path, PathBuf};

use tracepilot_core::ids::SessionId;

use super::security::collect_entries;
use super::types::{SessionFileEntry, SessionFileType};
use crate::config::TracePilotConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{explorer_roots, resolve_session};

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ExplorerScope {
    /// One directory, browsed as the tree's root.
    Single(PathBuf),
    /// Sibling directories under `base`, each a top-level folder named after
    /// itself. Only these names are ever listed or read.
    Named { base: PathBuf, names: Vec<String> },
}

impl ExplorerScope {
    /// The scope of a session's browsable roots, which
    /// [`explorer_roots`] has checked lie under the source's own root.
    pub(super) fn for_session(config: &TracePilotConfig, id: &SessionId) -> CmdResult<Self> {
        Self::from_roots(explorer_roots(&resolve_session(config, id)?)?)
    }

    pub(super) fn from_roots(mut roots: Vec<PathBuf>) -> CmdResult<Self> {
        if roots.len() == 1 {
            return Ok(Self::Single(roots.remove(0)));
        }
        let invalid = || BindingsError::Validation("Session file roots are not siblings".into());
        let base = roots
            .first()
            .and_then(|root| root.parent())
            .ok_or_else(invalid)?
            .to_path_buf();
        let mut names = Vec::with_capacity(roots.len());
        for root in &roots {
            let name = root
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.starts_with('.'))
                .ok_or_else(invalid)?;
            if root.parent() != Some(base.as_path()) || names.iter().any(|n| n == name) {
                return Err(invalid());
            }
            names.push(name.to_string());
        }
        Ok(Self::Named { base, names })
    }

    /// The directory entry paths are relative to: the single root, or the
    /// base the named directories sit in.
    pub(super) fn root(&self) -> &Path {
        match self {
            Self::Single(root) => root,
            Self::Named { base, .. } => base,
        }
    }

    /// The directory `relative` lives in, and its path inside that
    /// directory. A named directory must be a real directory inside the
    /// base, never a link out of it. Callers still validate and contain the
    /// rest.
    pub(super) fn locate<'a>(&self, relative: &'a str) -> CmdResult<(PathBuf, &'a str)> {
        match self {
            Self::Single(root) => Ok((root.clone(), relative)),
            Self::Named { base, names } => {
                let not_found = || BindingsError::Validation(format!("File not found: {relative}"));
                let (head, rest) = relative.split_once(['/', '\\']).unwrap_or((relative, ""));
                if !names.iter().any(|name| name == head) {
                    return Err(not_found());
                }
                if rest.is_empty() {
                    return Err(BindingsError::Validation(format!(
                        "'{relative}' is a directory, not a file"
                    )));
                }
                let base = base.canonicalize().ok().ok_or_else(not_found)?;
                let dir = named_dir(&base, head).ok_or_else(not_found)?;
                Ok((dir, rest))
            }
        }
    }

    /// Every browsable entry, with paths relative to the tree's root. A
    /// missing named directory is skipped; a missing single root is an error.
    pub(super) fn list(&self, session_id: &str) -> CmdResult<Vec<SessionFileEntry>> {
        let mut entries = Vec::new();
        match self {
            Self::Single(root) => {
                // Canonicalize before walking so subdirectories are checked
                // against an authoritative prefix (TOCTOU mitigation).
                let canonical = root.canonicalize().map_err(|e| {
                    if e.kind() == std::io::ErrorKind::NotFound {
                        BindingsError::Validation(format!(
                            "Session directory not found: {session_id}"
                        ))
                    } else {
                        BindingsError::Validation(format!("Failed to resolve session dir: {e}"))
                    }
                })?;
                collect_entries(&canonical, &canonical, 0, &mut entries)?;
            }
            Self::Named { base, names } => {
                let Ok(canonical_base) = base.canonicalize() else {
                    return Ok(entries);
                };
                for name in names {
                    let Some(dir) = named_dir(&canonical_base, name) else {
                        continue;
                    };
                    entries.push(SessionFileEntry {
                        path: name.clone(),
                        name: name.clone(),
                        size_bytes: 0,
                        is_directory: true,
                        file_type: SessionFileType::Binary, // unused for dirs
                    });
                    collect_entries(&canonical_base, &dir, 1, &mut entries)?;
                }
            }
        }
        Ok(entries)
    }
}

/// `base/name` when it is a real directory (not a link) inside `base`.
fn named_dir(canonical_base: &Path, name: &str) -> Option<PathBuf> {
    let path = canonical_base.join(name);
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return None;
    }
    let canonical = path.canonicalize().ok()?;
    (canonical.parent() == Some(canonical_base)).then_some(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn named(base: &Path) -> ExplorerScope {
        ExplorerScope::from_roots(vec![base.join("subagents"), base.join("tool-results")]).unwrap()
    }

    #[test]
    fn one_root_is_browsed_as_before() {
        let root = PathBuf::from("session");
        let scope = ExplorerScope::from_roots(vec![root.clone()]).unwrap();
        assert_eq!(scope, ExplorerScope::Single(root.clone()));
        assert_eq!(scope.root(), root);
        assert_eq!(scope.locate("a/b.md").unwrap(), (root, "a/b.md"));
    }

    #[test]
    fn named_roots_must_be_distinct_siblings() {
        let base = PathBuf::from("s");
        for roots in [
            vec![],
            vec![base.join("a"), PathBuf::from("other").join("b")],
            vec![base.join("a"), base.join("a")],
            vec![base.join("a"), base.join(".hidden")],
        ] {
            assert!(ExplorerScope::from_roots(roots).is_err());
        }
    }

    #[test]
    fn named_roots_list_and_locate_only_their_own_folders() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().join("session");
        std::fs::create_dir_all(base.join("subagents")).unwrap();
        std::fs::create_dir_all(base.join("other")).unwrap();
        std::fs::write(base.join("subagents").join("agent-a.jsonl"), "{}\n").unwrap();
        std::fs::write(base.join("other").join("secret.txt"), "x").unwrap();
        std::fs::write(base.join("top.txt"), "x").unwrap();
        let scope = named(&base);
        // Entry paths such as `subagents/agent-a.jsonl` are relative to the
        // session's own directory, not to the named folders.
        assert_eq!(scope.root(), base);

        let mut paths: Vec<_> = scope
            .list("id")
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        paths.sort();
        // tool-results/ does not exist yet; other/ and top.txt are not roots.
        assert_eq!(paths, ["subagents", "subagents/agent-a.jsonl"]);

        let subagents = base.join("subagents").canonicalize().unwrap();
        let (dir, rest) = scope.locate("subagents/agent-a.jsonl").unwrap();
        assert_eq!((dir, rest), (subagents.clone(), "agent-a.jsonl"));
        assert_eq!(
            scope.locate("subagents\\x.txt").unwrap(),
            (subagents, "x.txt")
        );
        // tool-results/ is a root but does not exist yet.
        for refused in [
            "other/secret.txt",
            "top.txt",
            "subagents",
            "tool-results/x.txt",
            "../x",
            "",
        ] {
            assert!(scope.locate(refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn a_missing_session_directory_lists_nothing() {
        let temp = tempfile::tempdir().unwrap();
        assert!(
            named(&temp.path().join("gone"))
                .list("id")
                .unwrap()
                .is_empty()
        );
        let single = ExplorerScope::Single(temp.path().join("gone"));
        assert!(single.list("id").is_err());
    }
}
