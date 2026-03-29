use criterion::{BatchSize, BenchmarkId, Criterion, criterion_group, criterion_main};
use tracepilot_bench::{SessionFixtureBuilder, create_multi_session_fixture, create_varied_session_fixture};
use tracepilot_indexer::index_db::IndexDb;

fn bench_upsert_session(c: &mut Criterion) {
    let mut group = c.benchmark_group("upsert_session");
    for turns in [5, 20, 50] {
        group.bench_function(format!("{turns}_turns"), |b| {
            b.iter_batched(
                || {
                    let db_dir = tempfile::tempdir().unwrap();
                    let db_path = db_dir.path().join("bench.db");
                    let db = IndexDb::open_or_create(&db_path).unwrap();

                    let (session_guard, session_path) = SessionFixtureBuilder::new()
                        .turn_count(turns)
                        .tool_call_count(turns * 2)
                        .build_session_dir();

                    (db_dir, db, session_guard, session_path)
                },
                |(_db_dir, db, _session_guard, session_path)| {
                    db.upsert_session(&session_path).unwrap();
                },
                BatchSize::SmallInput,
            );
        });
    }
    group.finish();
}

/// Benchmark full reindex (parallel parse + sequential write).
fn bench_reindex_all(c: &mut Criterion) {
    let mut group = c.benchmark_group("reindex_all");
    group.sample_size(10);
    for count in [10, 50, 100] {
        let (_sessions_guard, sessions_path) = create_multi_session_fixture(count, 50);

        group.throughput(criterion::Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::from_parameter(count), &sessions_path, |b, sessions_path| {
            b.iter_batched(
                || {
                    let db_dir = tempfile::tempdir().unwrap();
                    let db_path = db_dir.path().join("bench.db");
                    (db_dir, db_path)
                },
                |(_db_dir, db_path)| {
                    tracepilot_indexer::reindex_all(sessions_path, &db_path).unwrap();
                },
                BatchSize::SmallInput,
            );
        });
    }
    group.finish();
}

fn bench_search(c: &mut Criterion) {
    let mut group = c.benchmark_group("search");
    for count in [10, 50, 100, 200] {
        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("bench.db");
        let db = IndexDb::open_or_create(&db_path).unwrap();

        let (_sessions_guard, sessions_path) = create_multi_session_fixture(count, 50);

        db.begin_transaction().unwrap();
        for entry in std::fs::read_dir(&sessions_path).unwrap() {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_dir() {
                let _ = db.upsert_session(&entry.path());
            }
        }
        db.commit_transaction().unwrap();

        group.throughput(criterion::Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::from_parameter(count), &db, |b, db| {
            b.iter(|| db.search("Refactor module").unwrap());
        });
    }
    group.finish();
}

fn bench_query_analytics(c: &mut Criterion) {
    let mut group = c.benchmark_group("query_analytics");
    for count in [10, 50, 100, 200] {
        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("bench.db");
        let db = IndexDb::open_or_create(&db_path).unwrap();

        let (_sessions_guard, sessions_path) = create_multi_session_fixture(count, 50);

        db.begin_transaction().unwrap();
        for entry in std::fs::read_dir(&sessions_path).unwrap() {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_dir() {
                let _ = db.upsert_session(&entry.path());
            }
        }
        db.commit_transaction().unwrap();

        group.throughput(criterion::Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::from_parameter(count), &db, |b, db| {
            b.iter(|| db.query_analytics(None, None, None, false).unwrap());
        });
    }
    group.finish();
}

/// Benchmark full reindex with varied session sizes (realistic distribution).
fn bench_reindex_varied(c: &mut Criterion) {
    let mut group = c.benchmark_group("reindex_varied");
    group.sample_size(10);
    for count in [50, 100] {
        let (_sessions_guard, sessions_path) = create_varied_session_fixture(count);

        group.throughput(criterion::Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::from_parameter(count), &sessions_path, |b, sessions_path| {
            b.iter_batched(
                || {
                    let db_dir = tempfile::tempdir().unwrap();
                    let db_path = db_dir.path().join("bench.db");
                    (db_dir, db_path)
                },
                |(_db_dir, db_path)| {
                    tracepilot_indexer::reindex_all(sessions_path, &db_path).unwrap();
                },
                BatchSize::SmallInput,
            );
        });
    }
    group.finish();
}

/// Benchmark FTS5 search content indexing (Phase 2).
///
/// This measures the full search indexing pipeline: session discovery, event parsing,
/// content extraction, and FTS5 upsert. Phase 1 (reindex_all) is run as setup since
/// search indexing depends on session metadata being present.
fn bench_reindex_search_content(c: &mut Criterion) {
    let mut group = c.benchmark_group("reindex_search_content");
    group.sample_size(10);

    for count in [10, 50, 100, 200] {
        let events_per_session = match count {
            10 => 200,   // larger sessions at small scale
            50 => 100,
            100 => 50,
            _ => 50,
        };
        let (_sessions_guard, sessions_path) = create_multi_session_fixture(count, events_per_session);

        group.throughput(criterion::Throughput::Elements(count as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(count),
            &sessions_path,
            |b, sessions_path| {
                b.iter_batched(
                    || {
                        let db_dir = tempfile::tempdir().unwrap();
                        let db_path = db_dir.path().join("bench.db");
                        // Phase 1 must run first — search indexing depends on session metadata
                        tracepilot_indexer::reindex_all(sessions_path, &db_path).unwrap();
                        (db_dir, db_path)
                    },
                    |(_db_dir, db_path)| {
                        tracepilot_indexer::reindex_search_content(
                            sessions_path,
                            &db_path,
                            |_| {},
                            || false,
                        )
                        .unwrap();
                    },
                    BatchSize::SmallInput,
                );
            },
        );
    }
    group.finish();
}

/// Benchmark search indexing with varied session profiles (realistic distribution).
///
/// Uses 40% Quick / 30% Standard / 20% AgentHeavy / 10% LargeRefactor sessions
/// to approximate real-world indexing load.
fn bench_reindex_search_varied(c: &mut Criterion) {
    let mut group = c.benchmark_group("reindex_search_varied");
    group.sample_size(10);

    for count in [50, 100] {
        let (_sessions_guard, sessions_path) = create_varied_session_fixture(count);

        group.throughput(criterion::Throughput::Elements(count as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(count),
            &sessions_path,
            |b, sessions_path| {
                b.iter_batched(
                    || {
                        let db_dir = tempfile::tempdir().unwrap();
                        let db_path = db_dir.path().join("bench.db");
                        tracepilot_indexer::reindex_all(sessions_path, &db_path).unwrap();
                        (db_dir, db_path)
                    },
                    |(_db_dir, db_path)| {
                        tracepilot_indexer::reindex_search_content(
                            sessions_path,
                            &db_path,
                            |_| {},
                            || false,
                        )
                        .unwrap();
                    },
                    BatchSize::SmallInput,
                );
            },
        );
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_upsert_session,
    bench_reindex_all,
    bench_reindex_varied,
    bench_search,
    bench_query_analytics,
    bench_reindex_search_content,
    bench_reindex_search_varied,
);
criterion_main!(benches);
