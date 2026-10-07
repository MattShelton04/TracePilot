//! Turning an optional session source on or off, or moving its root.
//!
//! The order is fixed (architecture §3.4):
//! 1. [`SourceChanges::bump`] advances each changed source's configuration
//!    generation while the new configuration is published, under the config
//!    lock that index passes capture their registry under. Every pass holding
//!    the old configuration then stops that source's work and rolls back its
//!    uncommitted writes instead of committing them.
//! 2. [`SourceChanges::purge`] deletes the rows of each source that was
//!    enabled, cascading to analytics and search content.
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

/// Each attempt waits out the index busy timeout (5 s) before failing.
const PURGE_ATTEMPTS: u32 = 3;

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
    /// A failure is logged, not returned: the configuration is already
    /// saved, and the next full pass purges every disabled source's rows.
    /// A moved source's leftover rows are pruned once its new root is
    /// fully listed.
    pub(crate) fn purge(&self, index_path: &Path) {
        if !self.purged_any() || !index_path.exists() {
            return;
        }
        let db = match IndexDb::open_or_create(index_path) {
            Ok(db) => db,
            Err(error) => {
                tracing::warn!(error = %error, "Could not open the index to purge a source");
                return;
            }
        };
        for change in self.0.iter().filter(|change| change.purge) {
            let source = change.source.as_str();
            // A long search write can outlast one busy timeout; try again.
            for attempt in 1..=PURGE_ATTEMPTS {
                match db.purge_source(change.source, &|| true) {
                    Ok(purged) => {
                        tracing::info!(source, purged, "Purged a disabled source's sessions");
                        break;
                    }
                    Err(error) => tracing::warn!(
                        source,
                        attempt,
                        error = %error,
                        "Purging a disabled source failed"
                    ),
                }
            }
        }
    }
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
    fn bump_advances_only_changed_sources() {
        let generations = SourceGenerations::new();
        change(true, false).bump(&generations);
        assert_eq!(generations.current(SessionSource::ClaudeCode), 1);
        assert_eq!(generations.current(SessionSource::Copilot), 0);
    }
}
