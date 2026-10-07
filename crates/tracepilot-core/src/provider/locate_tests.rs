//! Locating sessions by id and the opaque `source_version`.

use std::sync::Arc;

use super::tests::{FIXTURE_ID, FixtureProvider, fixture_events};
use super::*;

fn fingerprint_of(size: u64, secs: u64, token: Option<&str>) -> SourceFingerprint {
    use crate::parsing::snapshot::FileFingerprint;
    let modified = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs);
    SourceFingerprint::new(
        vec![
            (
                "s/events.jsonl".into(),
                Some(FileFingerprint { modified, size }),
            ),
            ("s/workspace.yaml".into(), None),
        ],
        token.map(Into::into),
    )
}

#[test]
fn source_version_is_stable_and_tracks_every_input() {
    let base = fingerprint_of(10, 100, None);
    let version = base.source_version();
    assert_eq!(version.len(), 32);
    assert!(version.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(version, fingerprint_of(10, 100, None).source_version());

    let mut absent = base.clone();
    absent.files[0].1 = None;
    let mut renamed = base.clone();
    renamed.files[0].0 = "t/events.jsonl".into();
    for changed in [
        fingerprint_of(11, 100, None),
        fingerprint_of(10, 101, None),
        fingerprint_of(10, 100, Some("v2")),
        absent,
        renamed,
    ] {
        assert_ne!(changed.source_version(), version);
    }
}

/// A source rooted in a real directory that counts fresh resolutions.
struct RootedProvider {
    root: std::path::PathBuf,
    resolves: std::sync::atomic::AtomicUsize,
}

impl RootedProvider {
    fn new(root: &std::path::Path) -> Self {
        Self {
            root: root.to_path_buf(),
            resolves: Default::default(),
        }
    }

    fn locator(&self, path: std::path::PathBuf, id: &str) -> SessionLocator {
        SessionLocator {
            source: SessionSource::ClaudeCode,
            id: SessionId::from_validated(id),
            primary_path: path,
            parent_id: None,
            role: SessionRole::Primary,
            source_bytes_hint: 0,
        }
    }

    fn resolves(&self) -> usize {
        self.resolves.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl SessionProvider for RootedProvider {
    fn source(&self) -> SessionSource {
        SessionSource::ClaudeCode
    }

    fn capabilities(&self) -> SourceCapabilities {
        SourceCapabilities::default()
    }

    fn discover(&self, _is_cancelled: &dyn Fn() -> bool) -> crate::Result<Vec<SessionLocator>> {
        Ok(Vec::new())
    }

    fn fingerprint(&self, _session: &SessionLocator) -> crate::Result<SourceFingerprint> {
        Ok(SourceFingerprint::new(Vec::new(), None))
    }

    fn load_snapshot(
        &self,
        session: &SessionLocator,
        strict: bool,
        is_cancelled: &dyn Fn() -> bool,
    ) -> crate::Result<ProviderSnapshot> {
        FixtureProvider.load_snapshot(session, strict, is_cancelled)
    }

    fn liveness(&self, _session: &SessionLocator) -> Liveness {
        Liveness::Unknown
    }

    fn root(&self) -> Option<&std::path::Path> {
        Some(&self.root)
    }

    fn resolve(&self, id: &SessionId) -> crate::Result<Option<SessionLocator>> {
        self.resolves
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let path = self.root.join("p").join(format!("{id}.jsonl"));
        Ok(path.exists().then(|| self.locator(path, id.as_str())))
    }
}

#[test]
fn locate_trusts_only_stored_locators_under_the_providers_root() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    let other = "22222222-3333-4444-8555-666666666666";
    for dir in [root.join("p"), temp.path().join("elsewhere")] {
        std::fs::create_dir_all(dir).unwrap();
    }
    for file in [
        root.join("p").join(format!("{FIXTURE_ID}.jsonl")),
        root.join("p").join(format!("{other}.jsonl")),
        temp.path()
            .join("elsewhere")
            .join(format!("{FIXTURE_ID}.jsonl")),
    ] {
        std::fs::write(file, "").unwrap();
    }
    let provider = Arc::new(RootedProvider::new(&root));
    let mut registry = ProviderRegistry::new();
    registry.register(Arc::clone(&provider) as Arc<dyn SessionProvider>);
    let id = SessionId::from_validated(FIXTURE_ID);
    let canonical = root.join("p").join(format!("{FIXTURE_ID}.jsonl"));

    let stored = provider.locator(canonical.clone(), FIXTURE_ID);
    let resolved = registry.locate(&id, Some(stored.clone())).unwrap().unwrap();
    assert_eq!(resolved.locator, stored);
    assert_eq!(
        provider.resolves(),
        0,
        "a trusted stored locator needs no scan"
    );

    let untrusted = [
        // An older root, a traversal out of the root, another session's
        // file, a row stored for another id, and a file that is gone.
        provider.locator(
            temp.path()
                .join("elsewhere")
                .join(format!("{FIXTURE_ID}.jsonl")),
            FIXTURE_ID,
        ),
        provider.locator(
            root.join("..")
                .join("elsewhere")
                .join(format!("{FIXTURE_ID}.jsonl")),
            FIXTURE_ID,
        ),
        provider.locator(root.join("p").join(format!("{other}.jsonl")), FIXTURE_ID),
        provider.locator(root.join("p").join(format!("{other}.jsonl")), other),
        provider.locator(
            root.join("gone").join(format!("{FIXTURE_ID}.jsonl")),
            FIXTURE_ID,
        ),
        provider.locator(root.clone(), FIXTURE_ID),
    ];
    for (index, stored) in untrusted.into_iter().enumerate() {
        let resolved = registry.locate(&id, Some(stored)).unwrap().unwrap();
        assert_eq!(resolved.locator.primary_path, canonical, "case {index}");
        assert_eq!(provider.resolves(), index + 1, "case {index} re-resolves");
    }
}

#[test]
fn locate_never_uses_a_row_from_an_unregistered_source() {
    let temp = tempfile::tempdir().unwrap();
    let corpus = tracepilot_test_support::copilot_corpus::write_copilot_corpus(temp.path());
    let mut registry = ProviderRegistry::new();
    registry.register(Arc::new(CopilotProvider::new(temp.path())));
    let copilot_id = SessionId::from_validated(corpus[0].0.id);
    let copilot_dir = temp.path().join(copilot_id.as_str());

    // A Claude Code row whose path happens to be a real Copilot directory.
    let mut stored = FixtureProvider::locator();
    stored.id = copilot_id.clone();
    stored.primary_path = copilot_dir.clone();
    let resolved = registry.locate(&copilot_id, Some(stored)).unwrap().unwrap();
    assert_eq!(resolved.locator.source, SessionSource::Copilot);
    assert_eq!(resolved.provider.source(), SessionSource::Copilot);

    let fixture_id = SessionId::from_validated(FIXTURE_ID);
    let stored = FixtureProvider::locator();
    assert!(
        registry
            .locate(&fixture_id, Some(stored))
            .unwrap()
            .is_none()
    );
    assert!(registry.locate(&fixture_id, None).unwrap().is_none());
}

#[test]
fn providers_without_a_root_never_trust_stored_locators() {
    assert_eq!(FixtureProvider.root(), None);
    assert!(!FixtureProvider.owns(&FixtureProvider::locator()));
    let mut registry = ProviderRegistry::new();
    registry.register(Arc::new(FixtureProvider));
    let id = SessionId::from_validated(FIXTURE_ID);
    // The stored path does not exist, so only `resolve` can produce it.
    let resolved = registry
        .locate(&id, Some(FixtureProvider::locator()))
        .unwrap()
        .unwrap();
    assert_eq!(resolved.locator, FixtureProvider::locator());
}

#[test]
fn default_event_and_summary_loads_come_from_the_snapshot() {
    let locator = FixtureProvider::locator();
    let events = FixtureProvider
        .load_events(&locator, &|| false)
        .unwrap()
        .unwrap();
    assert_eq!(events.len(), fixture_events().len());
    let summary = FixtureProvider
        .summary_from_events(&locator, &events)
        .unwrap();
    assert_eq!(summary.summary.as_deref(), Some("Fixture"));
    assert!(FixtureProvider.file_roots(&locator).unwrap().is_empty());
}
