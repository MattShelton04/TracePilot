use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use tracepilot_bench::{SessionFixtureBuilder, generate_events_jsonl_string};

fn bench_parse_typed_events(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_typed_events");
    for size in [100, 1000, 10000] {
        // Pre-generate JSONL and write once per size; reuse across iterations
        let jsonl = generate_events_jsonl_string(size);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        std::fs::write(&path, &jsonl).unwrap();

        group.throughput(criterion::Throughput::Bytes(jsonl.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), &path, |b, path| {
            b.iter(|| {
                tracepilot_core::parsing::events::parse_typed_events(path).unwrap()
            });
        });
    }
    group.finish();
}

fn bench_reconstruct_turns(c: &mut Criterion) {
    let mut group = c.benchmark_group("reconstruct_turns");
    for size in [100, 500, 2000] {
        let turns = size / 5;
        let tools = size / 10;
        let (_dir, session_dir) = SessionFixtureBuilder::new()
            .turn_count(turns)
            .tool_call_count(tools)
            .build_session_dir();
        let parsed = tracepilot_core::parsing::events::parse_typed_events(
            &session_dir.join("events.jsonl"),
        )
        .unwrap();
        group.throughput(criterion::Throughput::Elements(parsed.events.len() as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(size),
            &parsed.events,
            |b, events| {
                b.iter(|| tracepilot_core::turns::reconstruct_turns(events));
            },
        );
    }
    group.finish();
}

criterion_group!(benches, bench_parse_typed_events, bench_reconstruct_turns);
criterion_main!(benches);
