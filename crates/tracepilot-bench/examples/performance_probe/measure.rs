use serde_json::{Value, json};
use std::io;
use std::path::Path;
use std::time::Instant;
use tracepilot_core::parsing::events::parse_typed_events;
use tracepilot_indexer::index_db::IndexDb;
use tracepilot_indexer::{SearchFilters, rebuild_search_content, reindex_all};

use super::model::{
    AnyError, ManifestSession, OperationSamples, PROBE_VERSION, ProbeReport, SEARCH_SENTINEL,
};
use super::validate::{
    fail, largest_corpus, load_owned_manifest, nanos_u64, validate_parsed, verify_corpus,
};

pub(super) fn probe_corpus(
    root: &Path,
    repeats: usize,
    command: Vec<String>,
) -> Result<ProbeReport, AnyError> {
    let manifest = load_owned_manifest(root)?;
    let sessions_root = root.join("copilot").join("session-state");
    let db_path = root.join("tracepilot").join("index.db");
    let verification = verify_corpus(root, &sessions_root, &manifest)?;
    let corpus = json!({
        "fixtureVersion": manifest.fixture_version,
        "scale": manifest.scale,
        "sessions": manifest.totals.session_count,
        "events": manifest.totals.event_count,
        "turns": manifest.totals.turn_count,
        "toolCalls": manifest.totals.tool_call_count
    });
    let mut operations = Vec::new();

    let (samples, last) = sample(repeats, || Ok(reindex_all(&sessions_root, &db_path)?))?;
    if last != manifest.totals.session_count {
        return fail(format!(
            "full reindex returned {last}, expected {}",
            manifest.totals.session_count
        ));
    }
    operations.push(operation(
        "full_reindex",
        corpus.clone(),
        samples,
        None,
        json!({"indexedSessions": last}),
    ));

    let (samples, last) = sample(repeats, || {
        Ok(tracepilot_indexer::reindex_incremental(
            &sessions_root,
            &db_path,
        )?)
    })?;
    if last != (0, manifest.totals.session_count) {
        return fail(format!(
            "incremental no-op returned {:?}, expected (0, {})",
            last, manifest.totals.session_count
        ));
    }
    operations.push(operation(
        "incremental_reindex_noop",
        corpus.clone(),
        samples,
        None,
        json!({"indexedSessions": last.0, "skippedSessions": last.1}),
    ));

    let (samples, last) = sample(repeats, || {
        Ok(rebuild_search_content(
            &sessions_root,
            &db_path,
            |_| {},
            || false,
        )?)
    })?;
    if last.0 != manifest.totals.session_count {
        return fail(format!(
            "search rebuild indexed {}, expected {}",
            last.0, manifest.totals.session_count
        ));
    }
    operations.push(operation(
        "search_content_rebuild",
        corpus.clone(),
        samples,
        None,
        json!({"indexedSessions": last.0, "skippedSessions": last.1}),
    ));

    let (samples, last) = sample(repeats, || {
        Ok(tracepilot_indexer::reindex_search_content(
            &sessions_root,
            &db_path,
            |_| {},
            || false,
        )?)
    })?;
    if last != (0, manifest.totals.session_count) {
        return fail(format!(
            "search no-op returned {:?}, expected (0, {})",
            last, manifest.totals.session_count
        ));
    }
    operations.push(operation(
        "search_content_reindex_noop",
        corpus.clone(),
        samples,
        None,
        json!({"indexedSessions": last.0, "skippedSessions": last.1}),
    ));

    let db = IndexDb::open_readonly(&db_path)?;
    measure_queries(&db, &manifest, repeats, &corpus, &mut operations)?;
    measure_largest_session(&sessions_root, &manifest.sessions, repeats, &mut operations)?;

    Ok(ProbeReport {
        probe_version: PROBE_VERSION,
        fixture_version: manifest.fixture_version,
        scale: manifest.scale,
        corpus_root: manifest.root,
        command,
        repeats,
        clock: "std::time::Instant",
        caveats: vec![
            "Release build time is excluded.",
            "Service functions are measured directly; desktop IPC and webview work are excluded.",
            "Filesystem cache state is uncontrolled.",
            "Samples are sequential and intentionally few; preserve the raw values for comparison.",
            "This probe diagnoses scaling and does not claim an optimization.",
        ],
        verification,
        operations,
    })
}

fn measure_queries(
    db: &IndexDb,
    manifest: &super::model::FixtureManifest,
    repeats: usize,
    corpus: &Value,
    operations: &mut Vec<OperationSamples>,
) -> Result<(), AnyError> {
    let (samples, sessions) = sample(repeats, || {
        Ok(db.list_sessions_filtered(None, None, None, false)?)
    })?;
    if sessions.len() != manifest.totals.session_count {
        return fail(format!(
            "list_sessions returned {}, expected {}",
            sessions.len(),
            manifest.totals.session_count
        ));
    }
    let list_json: Vec<Value> = sessions
        .iter()
        .map(|s| json!({"id": s.id, "eventCount": s.event_count, "turnCount": s.turn_count}))
        .collect();
    operations.push(operation(
        "list_sessions",
        corpus.clone(),
        samples,
        Some(serde_json::to_vec(&list_json)?.len()),
        json!({"sessionCount": sessions.len()}),
    ));

    let (samples, analytics) =
        sample(repeats, || Ok(db.query_analytics(None, None, None, false)?))?;
    if analytics.total_sessions as usize != manifest.totals.session_count {
        return fail(format!(
            "analytics returned {} sessions, expected {}",
            analytics.total_sessions, manifest.totals.session_count
        ));
    }
    operations.push(operation(
        "analytics",
        corpus.clone(),
        samples,
        Some(serde_json::to_vec(&analytics)?.len()),
        json!({"totalSessions": analytics.total_sessions, "totalTokens": analytics.total_tokens}),
    ));

    let (samples, tools) = sample(repeats, || {
        Ok(db.query_tool_analysis(None, None, None, false)?)
    })?;
    if tools.total_calls as usize != manifest.totals.tool_call_count {
        return fail(format!(
            "tool analysis returned {} calls, expected {}",
            tools.total_calls, manifest.totals.tool_call_count
        ));
    }
    operations.push(operation(
        "tool_analysis",
        corpus.clone(),
        samples,
        Some(serde_json::to_vec(&tools)?.len()),
        json!({"totalCalls": tools.total_calls, "toolKinds": tools.tools.len()}),
    ));

    let (samples, impact) = sample(repeats, || {
        Ok(db.query_code_impact(None, None, None, false)?)
    })?;
    if impact.lines_added == 0 || impact.files_modified == 0 {
        return fail("code impact unexpectedly contained no changes");
    }
    operations.push(operation(
        "code_impact",
        corpus.clone(),
        samples,
        Some(serde_json::to_vec(&impact)?.len()),
        json!({"filesModified": impact.files_modified, "linesAdded": impact.lines_added}),
    ));

    let filters = SearchFilters {
        limit: Some(50),
        ..Default::default()
    };
    let (samples, search_results) = sample(repeats, || {
        Ok(db.query_content(Some(SEARCH_SENTINEL), &filters)?)
    })?;
    if search_results.is_empty() {
        return fail("content search returned no matches for stable sentinel");
    }
    let search_json: Vec<Value> = search_results
        .iter()
        .map(|r| json!({"id": r.id, "sessionId": r.session_id, "contentType": r.content_type, "snippet": r.snippet}))
        .collect();
    operations.push(operation(
        "content_search_refactor",
        corpus.clone(),
        samples,
        Some(serde_json::to_vec(&search_json)?.len()),
        json!({"returnedRows": search_results.len(), "limit": 50}),
    ));

    let (samples, facets) = sample(repeats, || Ok(db.facets(Some(SEARCH_SENTINEL), &filters)?))?;
    if facets.total_matches as usize != manifest.totals.expected_search_matches
        || facets.session_count as usize != manifest.totals.session_count
    {
        return fail(format!(
            "search facets returned {} matches in {} sessions, expected {} in {}",
            facets.total_matches,
            facets.session_count,
            manifest.totals.expected_search_matches,
            manifest.totals.session_count
        ));
    }
    let facets_json = json!({
        "byContentType": facets.by_content_type,
        "byRepository": facets.by_repository,
        "byToolName": facets.by_tool_name,
        "totalMatches": facets.total_matches,
        "sessionCount": facets.session_count
    });
    operations.push(operation(
        "search_facets_refactor",
        corpus.clone(),
        samples,
        Some(serde_json::to_vec(&facets_json)?.len()),
        json!({"totalMatches": facets.total_matches, "sessionCount": facets.session_count}),
    ));

    let (samples, count) = sample(repeats, || {
        Ok(db.query_count(Some(SEARCH_SENTINEL), &filters)?)
    })?;
    if count as usize != manifest.totals.expected_search_matches {
        return fail(format!(
            "search count returned {count}, expected {}",
            manifest.totals.expected_search_matches
        ));
    }
    operations.push(operation(
        "search_count_refactor",
        corpus.clone(),
        samples,
        Some(std::mem::size_of_val(&count)),
        json!({"matchingRows": count}),
    ));
    Ok(())
}

fn measure_largest_session(
    sessions_root: &Path,
    sessions: &[ManifestSession],
    repeats: usize,
    operations: &mut Vec<OperationSamples>,
) -> Result<(), AnyError> {
    let largest = sessions
        .iter()
        .max_by_key(|session| session.event_count)
        .ok_or_else(|| io::Error::other("manifest contains no sessions"))?;
    let largest_path = sessions_root.join(&largest.id);
    let events_path = largest_path.join("events.jsonl");
    let (samples, parsed) = sample(repeats, || Ok(parse_typed_events(&events_path)?))?;
    validate_parsed(largest, &parsed)?;
    operations.push(operation(
        "largest_session_parse",
        largest_corpus(largest),
        samples,
        None,
        json!({"parsedEvents": parsed.events.len(), "parseWarnings": parsed.diagnostics.has_warnings()}),
    ));

    let cached_events = parsed.events;
    let (samples, summary) = sample(repeats, || {
        Ok(tracepilot_core::summary::load_session_summary_from_events(
            &largest_path,
            &cached_events,
        )?)
    })?;
    if summary.id != largest.id || summary.event_count != Some(largest.event_count) {
        return fail("cached-event summary did not match the largest manifest session");
    }
    operations.push(operation(
        "largest_session_summary_cached_events",
        largest_corpus(largest),
        samples,
        Some(serde_json::to_vec(&summary)?.len()),
        json!({"eventCount": summary.event_count, "turnCount": summary.turn_count}),
    ));

    let (samples, turns) = sample(repeats, || {
        Ok::<_, AnyError>(tracepilot_core::turns::reconstruct_turns(&cached_events))
    })?;
    if turns.len() != largest.turn_count {
        return fail(format!(
            "largest reconstruction returned {} turns, expected {}",
            turns.len(),
            largest.turn_count
        ));
    }
    operations.push(operation(
        "largest_session_reconstruct_turns",
        largest_corpus(largest),
        samples,
        None,
        json!({"turnCount": turns.len()}),
    ));

    let mut prepare_samples = Vec::with_capacity(repeats);
    let mut prepared = None;
    for _ in 0..repeats {
        let mut candidate = turns.clone();
        let started = Instant::now();
        tracepilot_core::turns::prepare_turns_for_ipc(&mut candidate);
        prepare_samples.push(nanos_u64(started.elapsed().as_nanos()));
        prepared = Some(candidate);
    }
    let prepared_turns = prepared.ok_or_else(|| io::Error::other("no prepared turns sample"))?;
    operations.push(operation(
        "largest_session_prepare_turns_for_ipc",
        largest_corpus(largest),
        prepare_samples,
        None,
        json!({"turnCount": prepared_turns.len(), "cloneExcluded": true}),
    ));

    let (serialize_samples, response) =
        sample(repeats, || Ok(serde_json::to_vec(&prepared_turns)?))?;
    let response_bytes = response.len();
    if response_bytes == 0 {
        return fail("largest-session turn serialization produced an empty response");
    }
    operations.push(operation(
        "largest_session_serialize_turns_json",
        largest_corpus(largest),
        serialize_samples,
        Some(response_bytes),
        json!({"turnCount": prepared_turns.len()}),
    ));
    Ok(())
}

fn sample<T, F>(repeats: usize, mut operation: F) -> Result<(Vec<u64>, T), AnyError>
where
    F: FnMut() -> Result<T, AnyError>,
{
    let mut samples = Vec::with_capacity(repeats);
    let mut last = None;
    for _ in 0..repeats {
        let started = Instant::now();
        let value = operation()?;
        samples.push(nanos_u64(started.elapsed().as_nanos()));
        last = Some(value);
    }
    let value = last.ok_or_else(|| io::Error::other("operation produced no samples"))?;
    Ok((samples, value))
}

fn operation(
    name: &str,
    corpus: Value,
    samples: Vec<u64>,
    response_bytes: Option<usize>,
    result: Value,
) -> OperationSamples {
    OperationSamples {
        name: name.to_string(),
        metric: "elapsed",
        unit: "nanoseconds",
        corpus,
        samples,
        response_bytes,
        result,
    }
}
