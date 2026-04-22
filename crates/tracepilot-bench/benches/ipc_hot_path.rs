//! IPC hot-path benchmarks.
//!
//! Measures the latency of service-layer functions that back the hottest IPC
//! commands documented in `perf-budget.json` (under `ipc.*`). Benches run
//! the Rust handlers directly against a freshly built, fully-indexed
//! `IndexDb`; the Tauri runtime is intentionally not involved so we can
//! isolate backend latency from the IPC bridge.
//!
//! Budget mapping (see `perf-budget.json`):
//!   list_sessions_filtered  → ipc.listSessionsMs
//!   query_content (browse)  → ipc.searchContentMs (warm cache)
//!   query_content (FTS)     → ipc.searchContentMs
//!   facets                  → ipc.getSearchFacetsMs
//!   fts_health              → ipc.ftsHealthMs
//!   query_tool_analysis     → ipc.getToolAnalysisMs
//!   query_code_impact       → ipc.getCodeImpactMs
//!   json_serialize_analytics→ (serialization leg of ipc.getAnalyticsMs)
//!
//! Run:
//!   cargo bench -p tracepilot-bench --bench ipc_hot_path
//!   cargo bench -p tracepilot-bench --bench ipc_hot_path -- list_sessions

use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use tempfile::TempDir;
use tracepilot_bench::create_multi_session_fixture;
use tracepilot_indexer::index_db::IndexDb;
use tracepilot_indexer::{SearchFilters, reindex_all, reindex_search_content};

/// Session corpus sizes used across the IPC hot-path benches.
///
/// Budgets in `perf-budget.json` target ~100 sessions; we bracket that with a
/// smaller and larger point to surface scaling behaviour.
const CORPUS_SIZES: &[usize] = &[50, 100, 200];

/// Build a fully-indexed DB (Phase 1 + Phase 2) with `count` sessions.
///
/// Returns `(temp_dir_guard_for_sessions, temp_dir_guard_for_db, db)`. Both
/// guards must stay alive for the lifetime of the returned `IndexDb`.
fn build_indexed_corpus(count: usize) -> (TempDir, TempDir, IndexDb) {
    let (sessions_guard, sessions_path) = create_multi_session_fixture(count, 80);
    let db_dir = tempfile::tempdir().expect("create db tempdir");
    let db_path = db_dir.path().join("bench.db");

    reindex_all(&sessions_path, &db_path).expect("reindex_all");
    reindex_search_content(&sessions_path, &db_path, |_| {}, || false)
        .expect("reindex_search_content");

    let db = IndexDb::open_readonly(&db_path).expect("open readonly");
    (sessions_guard, db_dir, db)
}

fn bench_list_sessions(c: &mut Criterion) {
    let mut group = c.benchmark_group("ipc_list_sessions");
    for &count in CORPUS_SIZES {
        let (_sg, _dg, db) = build_indexed_corpus(count);
        group.throughput(Throughput::Elements(count as u64));

        group.bench_with_input(BenchmarkId::new("no_filter", count), &db, |b, db| {
            b.iter(|| {
                db.list_sessions_filtered(None, None, None, false, None)
                    .unwrap()
            });
        });
        group.bench_with_input(BenchmarkId::new("hide_empty", count), &db, |b, db| {
            b.iter(|| {
                db.list_sessions_filtered(Some(100), None, None, true, None)
                    .unwrap()
            });
        });
        group.bench_with_input(BenchmarkId::new("repo_filter", count), &db, |b, db| {
            b.iter(|| {
                db.list_sessions_filtered(
                    Some(100),
                    Some("github.com/bench/project"),
                    None,
                    true,
                    None,
                )
                .unwrap()
            });
        });
    }
    group.finish();
}

fn bench_search_content(c: &mut Criterion) {
    let mut group = c.benchmark_group("ipc_search_content");
    for &count in CORPUS_SIZES {
        let (_sg, _dg, db) = build_indexed_corpus(count);
        group.throughput(Throughput::Elements(count as u64));

        let filters = SearchFilters {
            limit: Some(50),
            ..Default::default()
        };

        group.bench_with_input(
            BenchmarkId::new("browse", count),
            &(&db, &filters),
            |b, (db, filters)| {
                b.iter(|| db.query_content(None, filters).unwrap());
            },
        );
        group.bench_with_input(
            BenchmarkId::new("fts_common_term", count),
            &(&db, &filters),
            |b, (db, filters)| {
                b.iter(|| db.query_content(Some("refactor"), filters).unwrap());
            },
        );
        group.bench_with_input(
            BenchmarkId::new("fts_rare_term", count),
            &(&db, &filters),
            |b, (db, filters)| {
                b.iter(|| db.query_content(Some("file_3"), filters).unwrap());
            },
        );
    }
    group.finish();
}

fn bench_search_facets(c: &mut Criterion) {
    let mut group = c.benchmark_group("ipc_search_facets");
    for &count in CORPUS_SIZES {
        let (_sg, _dg, db) = build_indexed_corpus(count);
        group.throughput(Throughput::Elements(count as u64));

        let filters = SearchFilters::default();

        group.bench_with_input(
            BenchmarkId::new("browse", count),
            &(&db, &filters),
            |b, (db, filters)| {
                b.iter(|| db.facets(None, filters).unwrap());
            },
        );
        group.bench_with_input(
            BenchmarkId::new("fts", count),
            &(&db, &filters),
            |b, (db, filters)| {
                b.iter(|| db.facets(Some("refactor"), filters).unwrap());
            },
        );
    }
    group.finish();
}

fn bench_fts_health(c: &mut Criterion) {
    let mut group = c.benchmark_group("ipc_fts_health");
    for &count in CORPUS_SIZES {
        let (_sg, _dg, db) = build_indexed_corpus(count);
        group.throughput(Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::from_parameter(count), &db, |b, db| {
            b.iter(|| db.fts_health().unwrap());
        });
    }
    group.finish();
}

fn bench_tool_analysis(c: &mut Criterion) {
    let mut group = c.benchmark_group("ipc_tool_analysis");
    for &count in CORPUS_SIZES {
        let (_sg, _dg, db) = build_indexed_corpus(count);
        group.throughput(Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::from_parameter(count), &db, |b, db| {
            b.iter(|| db.query_tool_analysis(None, None, None, false).unwrap());
        });
    }
    group.finish();
}

fn bench_code_impact(c: &mut Criterion) {
    let mut group = c.benchmark_group("ipc_code_impact");
    for &count in CORPUS_SIZES {
        let (_sg, _dg, db) = build_indexed_corpus(count);
        group.throughput(Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::from_parameter(count), &db, |b, db| {
            b.iter(|| db.query_code_impact(None, None, None, false).unwrap());
        });
    }
    group.finish();
}

/// Bench the JSON-serialization leg of the IPC round-trip. The Tauri bridge
/// serializes command return values to JSON before posting to the webview, so
/// this is part of the "getAnalytics" budget even though it's not SQL.
fn bench_analytics_serialization(c: &mut Criterion) {
    let mut group = c.benchmark_group("ipc_analytics_serialize");
    for &count in CORPUS_SIZES {
        let (_sg, _dg, db) = build_indexed_corpus(count);
        let analytics = db.query_analytics(None, None, None, false).unwrap();
        let tool = db.query_tool_analysis(None, None, None, false).unwrap();
        let impact = db.query_code_impact(None, None, None, false).unwrap();

        group.throughput(Throughput::Elements(count as u64));
        group.bench_with_input(
            BenchmarkId::new("analytics_data", count),
            &analytics,
            |b, v| b.iter(|| serde_json::to_string(v).unwrap()),
        );
        group.bench_with_input(
            BenchmarkId::new("tool_analysis_data", count),
            &tool,
            |b, v| b.iter(|| serde_json::to_string(v).unwrap()),
        );
        group.bench_with_input(
            BenchmarkId::new("code_impact_data", count),
            &impact,
            |b, v| b.iter(|| serde_json::to_string(v).unwrap()),
        );
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_list_sessions,
    bench_search_content,
    bench_search_facets,
    bench_fts_health,
    bench_tool_analysis,
    bench_code_impact,
    bench_analytics_serialization,
);
criterion_main!(benches);
