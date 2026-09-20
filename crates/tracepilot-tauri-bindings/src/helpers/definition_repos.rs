//! Repository roots shared by the Skills and Agents catalogs.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::config::TracePilotConfig;

/// Discover local definitions without requiring an orchestration registry entry.
/// Session CWDs may be subdirectories or worktrees; walk to their nearest `.git`.
/// This is read-only and does not register repositories as a side effect.
pub(crate) fn definition_repo_roots(cfg: &TracePilotConfig, extra: Option<&str>) -> Vec<PathBuf> {
    let registered =
        tracepilot_orchestrator::repo_registry::list_registered_repos_in(&cfg.tracepilot_home())
            .unwrap_or_else(|error| {
                tracing::warn!("Could not read the repository registry: {error}");
                Vec::new()
            });
    let cwds = super::open_index_db(&cfg.index_db_path())
        .and_then(|open| {
            open.db
                .distinct_session_cwds()
                .map_err(|error| {
                    tracing::warn!("Could not read session repository paths: {error}");
                })
                .ok()
        })
        .unwrap_or_default();
    collect_roots(
        registered
            .into_iter()
            .map(|repo| PathBuf::from(repo.path))
            .chain(extra.map(PathBuf::from)),
        &cwds,
    )
}

fn collect_roots(known: impl Iterator<Item = PathBuf>, cwds: &[String]) -> Vec<PathBuf> {
    let session_roots = cwds.iter().filter_map(|cwd| {
        Path::new(cwd)
            .ancestors()
            .find(|path| path.join(".git").exists())
            .map(Path::to_path_buf)
    });
    let mut seen = BTreeSet::new();
    known
        .chain(session_roots)
        .filter(|path| path.is_dir())
        .filter(|path| {
            path.canonicalize()
                .is_ok_and(|canonical| seen.insert(canonical))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_registered_and_session_projects_once_and_skips_missing_roots() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        let worktree = temp.path().join("worktree");
        let registered = temp.path().join("registered");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::write(worktree.join(".git"), "gitdir: ../repo/.git/worktrees/test").unwrap();
        std::fs::create_dir_all(&registered).unwrap();
        let roots = collect_roots(
            [repo.clone(), registered.clone(), temp.path().join("gone")].into_iter(),
            &[
                repo.join("src").to_string_lossy().into(),
                worktree.to_string_lossy().into(),
            ],
        );
        assert_eq!(roots.len(), 3);
        for root in [repo, worktree, registered] {
            assert!(roots.contains(&root));
        }
    }
}
