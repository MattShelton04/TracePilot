use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use tracepilot_bench::generate_analytics_inputs;

fn bench_compute_analytics(c: &mut Criterion) {
    let mut group = c.benchmark_group("compute_analytics");
    for count in [10, 50, 100, 200] {
        let (inputs, _dir) = generate_analytics_inputs(count, 10, 2);
        group.throughput(criterion::Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::from_parameter(count), &inputs, |b, inputs| {
            b.iter(|| tracepilot_core::analytics::compute_analytics(inputs));
        });
    }
    group.finish();
}

fn bench_compute_tool_analysis(c: &mut Criterion) {
    let mut group = c.benchmark_group("compute_tool_analysis");
    for count in [10, 50, 100, 200] {
        let (inputs, _dir) = generate_analytics_inputs(count, 10, 2);
        group.throughput(criterion::Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::from_parameter(count), &inputs, |b, inputs| {
            b.iter(|| tracepilot_core::analytics::compute_tool_analysis(inputs));
        });
    }
    group.finish();
}

fn bench_compute_code_impact(c: &mut Criterion) {
    let mut group = c.benchmark_group("compute_code_impact");
    for count in [10, 50, 100, 200] {
        let (inputs, _dir) = generate_analytics_inputs(count, 10, 2);
        group.throughput(criterion::Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::from_parameter(count), &inputs, |b, inputs| {
            b.iter(|| tracepilot_core::analytics::compute_code_impact(inputs));
        });
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_compute_analytics,
    bench_compute_tool_analysis,
    bench_compute_code_impact
);
criterion_main!(benches);
