use std::sync::Mutex;
use std::sync::atomic::AtomicUsize;
use std::time::Instant;

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::{SessionRole, SessionSource};

use super::*;
use crate::indexing::batches::MAX_SOURCE_BYTES;

const MIB: u64 = 1024 * 1024;

fn sessions(sizes: &[u64]) -> Vec<SessionLocator> {
    sizes
        .iter()
        .enumerate()
        .map(|(index, size)| SessionLocator {
            source: SessionSource::ClaudeCode,
            id: SessionId::from_validated(index.to_string()),
            primary_path: index.to_string().into(),
            parent_id: None,
            role: SessionRole::Primary,
            source_bytes_hint: *size,
        })
        .collect()
}

fn index_of(session: &SessionLocator) -> usize {
    session.id.as_str().parse().unwrap()
}

/// Counts how many preparations overlap.
#[derive(Default)]
struct Overlap {
    active: AtomicUsize,
    peak: AtomicUsize,
}

impl Overlap {
    fn run<T>(&self, work: impl FnOnce() -> T) -> T {
        let now = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(now, Ordering::SeqCst);
        let result = work();
        self.active.fetch_sub(1, Ordering::SeqCst);
        result
    }
}

#[test]
fn writes_every_batch_in_order_whichever_worker_finishes_first() {
    // Oversized sessions are one batch each; earlier ones finish last.
    let all = sessions(&[20 * MIB, 20 * MIB, 20 * MIB, 1, 1, 1]);
    let refs: Vec<_> = all.iter().collect();
    let prepare = |session: &SessionLocator, _: &dyn Fn() -> bool| {
        let index = index_of(session);
        std::thread::sleep(Duration::from_millis(40 - 10 * index.min(3) as u64));
        index
    };
    let mut written = Vec::new();
    let outcome = prepare_and_write(&refs, &prepare, &|| false, |batch, results| {
        assert_eq!(batch.len(), results.len());
        written.push(results);
        Ok(Flow::Continue)
    })
    .unwrap();
    assert_eq!(outcome, Outcome::Finished);
    assert_eq!(written, [vec![0], vec![1], vec![2], vec![3, 4, 5]]);
}

#[test]
fn oversized_sessions_overlap_within_the_byte_budget() {
    let size = MAX_SOURCE_BYTES + 1;
    let all = sessions(&[size; 12]);
    let refs: Vec<_> = all.iter().collect();
    let overlap = Overlap::default();
    let prepare = |_: &SessionLocator, _: &dyn Fn() -> bool| {
        overlap.run(|| std::thread::sleep(Duration::from_millis(30)));
    };
    let mut batches = 0;
    prepare_and_write(&refs, &prepare, &|| false, |batch, _| {
        assert_eq!(batch.len(), 1, "an oversized session is its own batch");
        batches += 1;
        Ok(Flow::Continue)
    })
    .unwrap();
    assert_eq!(batches, 12);
    let peak = overlap.peak.load(Ordering::SeqCst);
    let budget = usize::try_from(MAX_BYTES_IN_FLIGHT / size).unwrap();
    if rayon::current_num_threads() > 1 {
        assert!(peak > 1, "oversized sessions were prepared one at a time");
    }
    assert!(peak <= budget.min(MAX_BATCHES_IN_FLIGHT), "peak {peak}");
}

#[test]
fn a_session_over_the_whole_budget_is_prepared_alone() {
    let all = sessions(&[1, MAX_BYTES_IN_FLIGHT + 1, 1]);
    let refs: Vec<_> = all.iter().collect();
    let overlap = Overlap::default();
    let alone = Mutex::new(Vec::new());
    let prepare = |session: &SessionLocator, _: &dyn Fn() -> bool| {
        overlap.run(|| {
            std::thread::sleep(Duration::from_millis(20));
            if index_of(session) == 1 {
                alone
                    .lock()
                    .unwrap()
                    .push(overlap.active.load(Ordering::SeqCst));
            }
        });
    };
    prepare_and_write(&refs, &prepare, &|| false, |_, _| Ok(Flow::Continue)).unwrap();
    assert_eq!(*alone.lock().unwrap(), [1]);
}

#[test]
fn stopping_mid_pass_writes_nothing_more_and_signals_the_workers() {
    let all = sessions(&[20 * MIB; 6]);
    let refs: Vec<_> = all.iter().collect();
    let stopped = AtomicBool::new(false);
    let started = Instant::now();
    // Workers after the first run until they are signalled.
    let prepare = |session: &SessionLocator, cancelled: &dyn Fn() -> bool| {
        while index_of(session) > 0 && !cancelled() {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "never signalled"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
    };
    let mut writes = 0;
    let outcome = prepare_and_write(
        &refs,
        &prepare,
        &|| stopped.load(Ordering::SeqCst),
        |_, _| {
            writes += 1;
            stopped.store(true, Ordering::SeqCst);
            Ok(Flow::Continue)
        },
    )
    .unwrap();
    assert_eq!(outcome, Outcome::Stopped);
    assert_eq!(writes, 1);
}

#[test]
fn a_writer_error_stops_the_workers_and_is_returned() {
    let all = sessions(&[20 * MIB; 4]);
    let refs: Vec<_> = all.iter().collect();
    let started = Instant::now();
    let prepare = |session: &SessionLocator, cancelled: &dyn Fn() -> bool| {
        while index_of(session) > 0 && !cancelled() {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "never signalled"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
    };
    let result = prepare_and_write(&refs, &prepare, &|| false, |_, _| {
        Err(crate::indexing::scope::stale_source(
            SessionSource::ClaudeCode,
        ))
    });
    assert!(result.is_err());
}

#[test]
#[should_panic(expected = "worker failed")]
fn a_worker_panic_reaches_the_caller() {
    let all = sessions(&[20 * MIB; 3]);
    let refs: Vec<_> = all.iter().collect();
    let prepare = |session: &SessionLocator, _: &dyn Fn() -> bool| {
        assert!(index_of(session) != 1, "worker failed");
    };
    let _ = prepare_and_write(&refs, &prepare, &|| false, |_, _| Ok(Flow::Continue));
}

#[test]
fn preparation_completes_inside_a_single_worker_rayon_pool() {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let all = sessions(&[20 * MIB, 20 * MIB, 1]);
        let refs: Vec<_> = all.iter().collect();
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(1)
            .build()
            .unwrap();
        let mut written = Vec::new();
        pool.install(|| {
            prepare_and_write(
                &refs,
                &|session: &SessionLocator, _: &dyn Fn() -> bool| index_of(session),
                &|| false,
                |_, results| {
                    written.extend(results);
                    Ok(Flow::Continue)
                },
            )
            .unwrap()
        });
        sender.send(written).unwrap();
    });
    assert_eq!(
        receiver.recv_timeout(Duration::from_secs(5)).unwrap(),
        [0, 1, 2]
    );
}

#[test]
fn a_stop_after_a_batch_is_prepared_and_before_it_is_written_writes_nothing() {
    // Each prepare completes its result, then the stop lands: the batch is
    // ready to write when the writer next looks.
    let all = sessions(&[20 * MIB, 20 * MIB, 1]);
    let refs: Vec<_> = all.iter().collect();
    let stopped = AtomicBool::new(false);
    let prepare = |session: &SessionLocator, _: &dyn Fn() -> bool| {
        let result = index_of(session);
        stopped.store(true, Ordering::SeqCst);
        result
    };
    let mut writes = 0;
    let outcome = prepare_and_write(
        &refs,
        &prepare,
        &|| stopped.load(Ordering::SeqCst),
        |_, _| {
            writes += 1;
            Ok(Flow::Continue)
        },
    )
    .unwrap();
    assert_eq!(outcome, Outcome::Stopped);
    assert_eq!(writes, 0);
}
