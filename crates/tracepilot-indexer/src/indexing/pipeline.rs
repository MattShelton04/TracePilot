//! Prepare the next batches on Rayon workers while the calling thread writes
//! the current one.
//!
//! Batches keep the grouping of [`take_batch`](super::batches::take_batch),
//! one transaction each, and each is written as soon as it is prepared, the
//! earliest first. Sessions are independent, so write order only changes the
//! order of progress and of new row ids. Only preparation overlaps: at most
//! [`MAX_BATCHES_IN_FLIGHT`] batches and [`MAX_BYTES_IN_FLIGHT`] of estimated
//! source are being prepared or waiting to be written at once. A batch larger
//! than the byte budget (one session of up to gigabytes, with its subagents)
//! counts as half of it, and only one is in flight at a time: the rest of the
//! pass flows past it instead of waiting.

use std::collections::BTreeMap;
use std::panic::{self, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use tracepilot_core::provider::SessionLocator;

use crate::Result;

/// Rayon's pool, sized to the machine, bounds how many sessions run at once;
/// this bounds how far preparation runs ahead of the writer.
pub(super) const MAX_BATCHES_IN_FLIGHT: usize = 8;
/// Parsing holds several times a session's source size, so this bounds the
/// extra memory. On a 90-session, 859 MiB Claude Code corpus it raised peak
/// memory from about 355 to 400 to 450 MiB; 192 MiB was faster but reached
/// about 720 MiB.
pub(super) const MAX_BYTES_IN_FLIGHT: u64 = 96 * 1024 * 1024;

/// What the writer wants after a batch.
pub(super) enum Flow {
    Continue,
    Stop,
}

/// How a pass ended.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Outcome {
    /// Every batch was written, or the writer stopped.
    Finished,
    /// `stop` returned true before a batch was written.
    Stopped,
}

/// Run `prepare` for every session and hand each batch's results, in the
/// batch's session order, to `write` on the calling thread. Batches are
/// written as they complete, so a later one can be written first.
///
/// `stop` may be `!Sync` (for example UI-owned state): only the calling thread
/// polls it, while it waits and before each write. Workers see an atomic
/// signal, passed to `prepare`, that is raised once `stop` returns true or the
/// pass ends early. Every worker is joined before this returns, including on
/// errors and panics; a worker panic is resumed here.
pub(super) fn prepare_and_write<T: Send>(
    sessions: &[&SessionLocator],
    prepare: &(dyn Fn(&SessionLocator, &dyn Fn() -> bool) -> T + Sync),
    stop: &dyn Fn() -> bool,
    mut write: impl FnMut(&[&SessionLocator], Vec<T>) -> Result<Flow>,
) -> Result<Outcome> {
    // A caller already running on a Rayon worker cannot block while waiting
    // for jobs queued behind it. Keep nested indexing synchronous.
    if rayon::current_thread_index().is_some() {
        return prepare_inline(sessions, prepare, stop, write);
    }
    let cancelled = AtomicBool::new(false);
    let signal = || cancelled.load(Ordering::Relaxed);
    rayon::in_place_scope(|scope| {
        // Dropped when this closure returns or unwinds, before the scope
        // joins its workers, so they stop at their next cancellation check.
        let _raise = RaiseOnDrop(&cancelled);
        let (sender, receiver) = mpsc::channel::<Message<T>>();
        let mut remaining = sessions;
        let mut in_flight = BTreeMap::<usize, InFlight<T>>::new();
        let mut next_seq = 0;
        let mut bytes_in_flight = 0_u64;
        let mut oversized_in_flight = false;
        loop {
            if stop() {
                return Ok(Outcome::Stopped);
            }
            // Admit batches while the budget allows; always keep one in flight.
            while !remaining.is_empty() {
                let mut rest = remaining;
                let batch = super::batches::take_batch(&mut rest);
                let charge = Charge::of(batch_bytes(batch));
                let fits = in_flight.len() < MAX_BATCHES_IN_FLIGHT
                    && !(charge.oversized && oversized_in_flight)
                    && bytes_in_flight.saturating_add(charge.bytes) <= MAX_BYTES_IN_FLIGHT;
                if !in_flight.is_empty() && !fits {
                    break;
                }
                remaining = rest;
                let seq = next_seq;
                next_seq += 1;
                for (index, session) in batch.iter().enumerate() {
                    let sender = sender.clone();
                    let signal = &signal;
                    scope.spawn(move |_| {
                        let result =
                            panic::catch_unwind(AssertUnwindSafe(|| prepare(session, signal)));
                        // The receiver outlives every worker; a send fails only
                        // while the caller unwinds, when no result is wanted.
                        let _ = sender.send((seq, index, result));
                    });
                }
                bytes_in_flight = bytes_in_flight.saturating_add(charge.bytes);
                oversized_in_flight |= charge.oversized;
                in_flight.insert(seq, InFlight::new(batch, charge));
            }
            if in_flight.is_empty() {
                return Ok(Outcome::Finished);
            }
            // The earliest batch that is fully prepared, so a large session
            // still being parsed never holds up the ones behind it.
            let ready = in_flight
                .iter()
                .find(|(_, batch)| batch.missing == 0)
                .map(|(seq, _)| *seq);
            let Some(ready) = ready else {
                // On a timeout, poll `stop` again. This scope holds a
                // sender, so the channel never disconnects.
                if let Ok((seq, index, result)) = receiver.recv_timeout(Duration::from_millis(5)) {
                    let result = result.unwrap_or_else(|payload| panic::resume_unwind(payload));
                    if let Some(batch) = in_flight.get_mut(&seq) {
                        batch.fill(index, result);
                    }
                }
                continue;
            };
            if let Some(done) = in_flight.remove(&ready) {
                bytes_in_flight -= done.charge.bytes;
                if done.charge.oversized {
                    oversized_in_flight = false;
                }
                let results = done.results.into_iter().flatten().collect();
                if let Flow::Stop = write(done.batch, results)? {
                    return Ok(Outcome::Finished);
                }
            }
        }
    })
}

/// One batch at a time on the calling thread, polling `stop` directly.
fn prepare_inline<T>(
    sessions: &[&SessionLocator],
    prepare: &(dyn Fn(&SessionLocator, &dyn Fn() -> bool) -> T + Sync),
    stop: &dyn Fn() -> bool,
    mut write: impl FnMut(&[&SessionLocator], Vec<T>) -> Result<Flow>,
) -> Result<Outcome> {
    let mut remaining = sessions;
    while !remaining.is_empty() {
        if stop() {
            return Ok(Outcome::Stopped);
        }
        let batch = super::batches::take_batch(&mut remaining);
        let results = batch.iter().map(|session| prepare(session, stop)).collect();
        if stop() {
            return Ok(Outcome::Stopped);
        }
        if let Flow::Stop = write(batch, results)? {
            break;
        }
    }
    Ok(Outcome::Finished)
}

type Message<T> = (usize, usize, std::thread::Result<T>);

/// What a batch counts against [`MAX_BYTES_IN_FLIGHT`].
#[derive(Clone, Copy)]
struct Charge {
    bytes: u64,
    /// Larger than the whole budget. One such batch is in flight at a time,
    /// charged half the budget, so smaller batches keep being prepared on
    /// the other workers instead of waiting for it.
    oversized: bool,
}

impl Charge {
    fn of(bytes: u64) -> Self {
        if bytes > MAX_BYTES_IN_FLIGHT {
            Self {
                bytes: MAX_BYTES_IN_FLIGHT / 2,
                oversized: true,
            }
        } else {
            Self {
                bytes,
                oversized: false,
            }
        }
    }
}

struct InFlight<'a, 'b, T> {
    batch: &'a [&'b SessionLocator],
    charge: Charge,
    results: Vec<Option<T>>,
    missing: usize,
}

impl<'a, 'b, T> InFlight<'a, 'b, T> {
    fn new(batch: &'a [&'b SessionLocator], charge: Charge) -> Self {
        Self {
            batch,
            charge,
            results: batch.iter().map(|_| None).collect(),
            missing: batch.len(),
        }
    }

    fn fill(&mut self, index: usize, result: T) {
        self.results[index] = Some(result);
        self.missing -= 1;
    }
}

fn batch_bytes(batch: &[&SessionLocator]) -> u64 {
    batch.iter().fold(0, |bytes, session| {
        bytes.saturating_add(session.source_bytes_hint)
    })
}

/// Raise the workers' signal however the pass ends, so the scope's join
/// waits only for their next cancellation check.
struct RaiseOnDrop<'a>(&'a AtomicBool);

impl Drop for RaiseOnDrop<'_> {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
#[path = "pipeline_tests.rs"]
mod tests;
