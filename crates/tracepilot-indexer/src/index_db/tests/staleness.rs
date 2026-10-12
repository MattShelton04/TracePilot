//! Stored stale markers avoid source I/O without changing freshness decisions.

use std::sync::atomic::{AtomicUsize, Ordering};

use tracepilot_core::error::{Result as CoreResult, TracePilotError};
use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::{
    Liveness, ProviderSnapshot, SessionLocator, SessionProvider, SessionRole, SessionSource,
    SourceCapabilities, SourceFingerprint,
};

use crate::index_db::IndexDb;

const ID: &str = "11111111-1111-4111-8111-111111111111";

#[derive(Clone, Copy, Debug, PartialEq)]
enum Failure {
    None,
    Fingerprint,
    SessionSerialization,
    SearchSerialization,
}

struct CountingProvider {
    source: SessionSource,
    failure: Failure,
    fingerprint_calls: AtomicUsize,
    session_calls: AtomicUsize,
    search_calls: AtomicUsize,
}

impl CountingProvider {
    fn new(source: SessionSource, failure: Failure) -> Self {
        Self {
            source,
            failure,
            fingerprint_calls: AtomicUsize::new(0),
            session_calls: AtomicUsize::new(0),
            search_calls: AtomicUsize::new(0),
        }
    }

    fn fail_at(&self, failure: Failure) -> CoreResult<()> {
        if self.failure == failure {
            return Err(TracePilotError::IoError(std::io::Error::other(
                "synthetic fingerprint failure",
            )));
        }
        Ok(())
    }

    fn calls(&self) -> (usize, usize, usize) {
        (
            self.fingerprint_calls.load(Ordering::Relaxed),
            self.session_calls.load(Ordering::Relaxed),
            self.search_calls.load(Ordering::Relaxed),
        )
    }
}

impl SessionProvider for CountingProvider {
    fn source(&self) -> SessionSource {
        self.source
    }
    fn capabilities(&self) -> SourceCapabilities {
        SourceCapabilities::default()
    }
    fn discover(&self, _: &dyn Fn() -> bool) -> CoreResult<Vec<SessionLocator>> {
        unreachable!("freshness does not discover sessions")
    }
    fn fingerprint(&self, _: &SessionLocator) -> CoreResult<SourceFingerprint> {
        self.fingerprint_calls.fetch_add(1, Ordering::Relaxed);
        self.fail_at(Failure::Fingerprint)?;
        Ok(SourceFingerprint::new(Vec::new(), None))
    }
    fn stored_fingerprint(&self, _: &SourceFingerprint) -> CoreResult<String> {
        self.session_calls.fetch_add(1, Ordering::Relaxed);
        self.fail_at(Failure::SessionSerialization)?;
        Ok("session-current".to_owned())
    }
    fn stored_search_fingerprint(&self, _: &SourceFingerprint) -> CoreResult<String> {
        self.search_calls.fetch_add(1, Ordering::Relaxed);
        self.fail_at(Failure::SearchSerialization)?;
        Ok("search-current".to_owned())
    }
    fn load_snapshot(
        &self,
        _: &SessionLocator,
        _: bool,
        _: &dyn Fn() -> bool,
    ) -> CoreResult<ProviderSnapshot> {
        unreachable!("freshness does not load snapshots")
    }
    fn liveness(&self, _: &SessionLocator) -> Liveness {
        unreachable!("freshness does not query liveness")
    }
    fn resolve(&self, _: &SessionId) -> CoreResult<Option<SessionLocator>> {
        unreachable!("freshness does not resolve sessions")
    }
}

#[derive(Clone, Copy, Debug)]
enum Stored {
    Missing,
    NullFingerprint,
    NullVersion,
    OldVersion,
    NotSearchIndexed,
    Current,
    Changed,
    InvalidFingerprint,
    InvalidVersion,
    QueryError,
}

const STATES: [Stored; 10] = [
    Stored::Missing,
    Stored::NullFingerprint,
    Stored::NullVersion,
    Stored::OldVersion,
    Stored::NotSearchIndexed,
    Stored::Current,
    Stored::Changed,
    Stored::InvalidFingerprint,
    Stored::InvalidVersion,
    Stored::QueryError,
];

fn setup(state: Stored, source: SessionSource) -> (tempfile::TempDir, IndexDb, SessionLocator) {
    let temp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    let locator = SessionLocator {
        id: SessionId::from_validated(ID),
        source,
        primary_path: temp.path().join(ID),
        parent_id: None,
        role: SessionRole::Primary,
        source_bytes_hint: 0,
    };
    if !matches!(state, Stored::Missing) {
        db.conn
            .execute(
                "INSERT INTO sessions (id, path, source_fingerprint, analytics_version,
                 search_source_fingerprint, search_extractor_version, search_indexed_at)
                 VALUES (?1, 'synthetic', 'session-current', 999,
                         'search-current', 999, '2026-01-01')",
                [ID],
            )
            .unwrap();
    }
    let sql = match state {
        Stored::Missing | Stored::Current => None,
        Stored::NullFingerprint => {
            Some("UPDATE sessions SET source_fingerprint=NULL, search_source_fingerprint=NULL")
        }
        Stored::NullVersion => {
            Some("UPDATE sessions SET analytics_version=NULL, search_extractor_version=NULL")
        }
        Stored::OldVersion => {
            Some("UPDATE sessions SET analytics_version=0, search_extractor_version=0")
        }
        Stored::NotSearchIndexed => Some("UPDATE sessions SET search_indexed_at=NULL"),
        Stored::Changed => Some(
            "UPDATE sessions SET source_fingerprint='previous', search_source_fingerprint='previous'",
        ),
        Stored::InvalidFingerprint => {
            Some("UPDATE sessions SET source_fingerprint=x'01', search_source_fingerprint=x'01'")
        }
        Stored::InvalidVersion => {
            Some("UPDATE sessions SET analytics_version=x'01', search_extractor_version=x'01'")
        }
        Stored::QueryError => Some(
            "ALTER TABLE sessions RENAME COLUMN source_fingerprint TO absent_source;
                  ALTER TABLE sessions RENAME COLUMN search_source_fingerprint TO absent_search",
        ),
    };
    if let Some(sql) = sql {
        db.conn.execute_batch(sql).unwrap();
    }
    (temp, db, locator)
}

#[test]
fn freshness_decisions_preserve_source_errors_and_database_fallbacks() {
    for source in [SessionSource::Copilot, SessionSource::ClaudeCode] {
        for state in STATES {
            let (_temp, db, locator) = setup(state, source);
            for failure in [
                Failure::None,
                Failure::Fingerprint,
                Failure::SessionSerialization,
                Failure::SearchSerialization,
            ] {
                let provider = CountingProvider::new(source, failure);
                let session_error = matches!(
                    failure,
                    Failure::Fingerprint | Failure::SessionSerialization
                );
                let expected_session =
                    session_error || !matches!(state, Stored::Current | Stored::NotSearchIndexed);
                assert_eq!(
                    db.session_is_stale(&provider, &locator),
                    expected_session,
                    "session {source:?} {state:?} {failure:?}"
                );
                let search_error =
                    matches!(failure, Failure::Fingerprint | Failure::SearchSerialization);
                let expected_search = search_error
                    || matches!(
                        state,
                        Stored::NullFingerprint
                            | Stored::NullVersion
                            | Stored::OldVersion
                            | Stored::NotSearchIndexed
                            | Stored::Changed
                    );
                assert_eq!(
                    db.search_is_stale(&provider, &locator),
                    expected_search,
                    "search {source:?} {state:?} {failure:?}"
                );
            }
        }
    }
}

#[test]
fn known_stale_rows_skip_fingerprints_but_current_rows_still_check_sources() {
    for source in [SessionSource::Copilot, SessionSource::ClaudeCode] {
        for state in STATES {
            let (_temp, db, locator) = setup(state, source);
            let session = CountingProvider::new(source, Failure::None);
            db.session_is_stale(&session, &locator);
            let session_needs_source = matches!(
                state,
                Stored::Current | Stored::Changed | Stored::NotSearchIndexed
            );
            let n = usize::from(session_needs_source);
            assert_eq!(session.calls(), (n, n, 0), "session {source:?} {state:?}");

            let search = CountingProvider::new(source, Failure::None);
            db.search_is_stale(&search, &locator);
            let search_needs_source = !matches!(
                state,
                Stored::NullFingerprint
                    | Stored::NullVersion
                    | Stored::OldVersion
                    | Stored::NotSearchIndexed
            );
            let n = usize::from(search_needs_source);
            assert_eq!(search.calls(), (n, 0, n), "search {source:?} {state:?}");
        }
    }
}
