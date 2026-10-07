//! Turning an optional session source on or off, or moving its root.
//!
//! The order is fixed (architecture §3.4):
//! 1. [`SourceChanges::bump`] advances each changed source's configuration
//!    generation while the new configuration is published, under the config
//!    lock that index passes capture their registry under. Every pass holding
//!    the old configuration then stops that source's work and rolls back its
//!    uncommitted writes instead of committing them.
//! 2. [`SourceChanges::purge`] deletes the rows of each source that was
//!    enabled, cascading to analytics and search content. A purge that fails
//!    (a busy or unreadable index) is returned as a [`PendingPurge`] for the
//!    caller to retry with [`retry_purges`].
//! 3. The caller invalidates caches, then reindexes each enabled source.
//!
//! A root change is a disable of the old root followed by an enable of the
//! new one. Copilot cannot be disabled, so its rows are never purged here.

use std::path::{Path, PathBuf};

use tracepilot_core::provider::SessionSource;
use tracepilot_indexer::SourceGenerations;
use tracepilot_indexer::index_db::IndexDb;

use crate::config::TracePilotConfig;
use crate::providers::claude_code_root;

/// One optional source whose root or enabled state changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SourceChange {
    pub source: SessionSource,
    /// Its rows belong to a configuration that no longer exists.
    pub purge: bool,
    /// It is enabled now and needs indexing.
    pub reindex: bool,
}

/// What a configuration change does to the optional sources.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct SourceChanges(Vec<SourceChange>);

/// The root of each optional source, `None` while it is disabled.
fn optional_roots(config: &TracePilotConfig) -> [(SessionSource, Option<PathBuf>); 1] {
    [(SessionSource::ClaudeCode, claude_code_root(config))]
}

impl SourceChanges {
    /// Compare the published configuration (`None` before setup) with the
    /// one about to replace it.
    pub(crate) fn between(old: Option<&TracePilotConfig>, new: &TracePilotConfig) -> Self {
        let changes = optional_roots(new)
            .into_iter()
            .filter_map(|(source, root)| {
                let previous = old.and_then(|old| {
                    optional_roots(old)
                        .into_iter()
                        .find(|(candidate, _)| *candidate == source)
                        .and_then(|(_, root)| root)
                });
                (previous != root).then_some(SourceChange {
                    source,
                    purge: previous.is_some(),
                    reindex: root.is_some(),
                })
            })
            .collect();
        Self(changes)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn purged_any(&self) -> bool {
        self.0.iter().any(|change| change.purge)
    }

    /// The sources to index now.
    pub(crate) fn to_reindex(&self) -> impl Iterator<Item = SessionSource> + '_ {
        self.0
            .iter()
            .filter(|change| change.reindex)
            .map(|change| change.source)
    }

    /// Invalidate every pass holding a changed source's old configuration.
    /// Call while holding the config write lock that publishes the change.
    pub(crate) fn bump(&self, generations: &SourceGenerations) {
        for change in &self.0 {
            generations.bump(change.source);
        }
    }

    /// Delete the rows of each changed source that was enabled. Call after
    /// [`Self::bump`] and after publishing the configuration, while still
    /// ordering configuration changes, so no re-enable can interleave.
    ///
    /// Returns the purges that failed. The configuration is already saved,
    /// so the caller retries them rather than undoing the change.
    pub(crate) fn purge(
        &self,
        index_path: &Path,
        generations: &SourceGenerations,
    ) -> Vec<PendingPurge> {
        let pending = self
            .0
            .iter()
            .filter(|change| change.purge)
            .map(|change| PendingPurge {
                source: change.source,
                generation: generations.current(change.source),
            })
            .collect::<Vec<_>>();
        retry_purges(&pending, index_path, generations)
    }
}

/// A source whose rows must still be purged, for the configuration
/// generation that disabled or moved it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PendingPurge {
    pub source: SessionSource,
    generation: u64,
}

/// Purge each pending source and return the ones that failed again. A purge
/// whose source changed since is dropped: that later change owns its rows.
pub(crate) fn retry_purges(
    pending: &[PendingPurge],
    index_path: &Path,
    generations: &SourceGenerations,
) -> Vec<PendingPurge> {
    let pending: Vec<PendingPurge> = pending
        .iter()
        .copied()
        .filter(|purge| generations.current(purge.source) == purge.generation)
        .collect();
    if pending.is_empty() || !index_path.exists() {
        return Vec::new();
    }
    let db = match IndexDb::open_or_create(index_path) {
        Ok(db) => db,
        Err(error) => {
            tracing::warn!(error = %error, "Could not open the index to purge a source");
            return pending;
        }
    };
    pending
        .into_iter()
        .filter(|purge| {
            let source = purge.source.as_str();
            let is_current = || generations.current(purge.source) == purge.generation;
            match db.purge_source(purge.source, &is_current) {
                Ok(purged) => {
                    tracing::info!(source, purged, "Purged a disabled source's sessions");
                    false
                }
                Err(error) => {
                    tracing::warn!(source, error = %error, "Purging a disabled source failed");
                    is_current()
                }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_claude(enabled: bool, root: &str) -> TracePilotConfig {
        let mut config = TracePilotConfig::default();
        config.features.claude_code_sessions = enabled;
        config.sources.claude_code.config_dir = root.into();
        config
    }

    fn change(purge: bool, reindex: bool) -> SourceChanges {
        SourceChanges(vec![SourceChange {
            source: SessionSource::ClaudeCode,
            purge,
            reindex,
        }])
    }

    #[test]
    fn enable_disable_and_move_are_told_apart() {
        let off = with_claude(false, "/a");
        let on = with_claude(true, "/a");
        let moved = with_claude(true, "/b");

        assert_eq!(SourceChanges::between(Some(&off), &on), change(false, true));
        assert_eq!(SourceChanges::between(Some(&on), &off), change(true, false));
        assert_eq!(
            SourceChanges::between(Some(&on), &moved),
            change(true, true)
        );
        assert_eq!(SourceChanges::between(None, &on), change(false, true));

        assert!(SourceChanges::between(Some(&on), &on).is_empty());
        assert!(SourceChanges::between(None, &off).is_empty());
        // Editing the folder while the source is off touches nothing.
        assert!(SourceChanges::between(Some(&off), &with_claude(false, "/b")).is_empty());
    }

    #[test]
    fn a_failed_purge_stays_pending_until_it_succeeds_or_is_superseded() {
        let temp = tempfile::tempdir().unwrap();
        let index = temp.path().join("index.db");
        // A directory where the index should be: every open fails.
        std::fs::create_dir(&index).unwrap();
        let generations = SourceGenerations::new();
        let disable = change(true, false);
        disable.bump(&generations);
        let pending = disable.purge(&index, &generations);
        assert_eq!(pending.len(), 1);

        std::fs::remove_dir(&index).unwrap();
        IndexDb::open_or_create(&index).unwrap();
        let conn = rusqlite::Connection::open(&index).unwrap();
        for (id, source) in [("copilot-1", "copilot"), ("claude-1", "claudeCode")] {
            conn.execute(
                "INSERT INTO sessions (id, path, source) VALUES (?1, ?1, ?2)",
                [id, source],
            )
            .unwrap();
        }
        let sources = || -> Vec<String> {
            let mut stmt = conn
                .prepare("SELECT source FROM sessions ORDER BY source")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };

        // Re-enabled meanwhile: the retry leaves the rows to the new change.
        generations.bump(SessionSource::ClaudeCode);
        assert!(retry_purges(&pending, &index, &generations).is_empty());
        assert_eq!(sources(), ["claudeCode", "copilot"]);

        let disable_again = change(true, false);
        disable_again.bump(&generations);
        let pending = PendingPurge {
            source: SessionSource::ClaudeCode,
            generation: generations.current(SessionSource::ClaudeCode),
        };
        assert!(retry_purges(&[pending], &index, &generations).is_empty());
        assert_eq!(sources(), ["copilot"]);
    }

    #[test]
    fn bump_advances_only_changed_sources() {
        let generations = SourceGenerations::new();
        change(true, false).bump(&generations);
        assert_eq!(generations.current(SessionSource::ClaudeCode), 1);
        assert_eq!(generations.current(SessionSource::Copilot), 0);
    }
}
