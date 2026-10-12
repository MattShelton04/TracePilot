//! Read-only JSONL parser probe. Run each revision in its own process against
//! the same frozen file; hashing is outside the timed region.
#![allow(clippy::print_stdout)]

use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

use sha2::{Digest, Sha256};
use tracepilot_core::parsing::events::parse_typed_events;

struct HashWriter(Sha256);

impl Write for HashWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let path = PathBuf::from(args.next().ok_or("usage: parse_probe <events.jsonl>")?);
    if args.next().is_some() {
        return Err("usage: parse_probe <events.jsonl>".into());
    }
    let source_bytes = std::fs::metadata(&path)?.len();
    let start = Instant::now();
    let parsed = parse_typed_events(&path)?;
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let mut output = HashWriter(Sha256::new());
    for event in &parsed.events {
        serde_json::to_writer(&mut output, &event.raw)?;
    }
    // Value canonicalizes the diagnostic HashMap keys before hashing.
    serde_json::to_writer(&mut output, &serde_json::to_value(&parsed.diagnostics)?)?;
    println!(
        "{}",
        serde_json::json!({
            "revision": option_env!("TRACEPILOT_PROBE_REVISION").unwrap_or("unrecorded"),
            "source_bytes": source_bytes,
            "events": parsed.events.len(),
            "elapsed_ms": elapsed_ms,
            "output_sha256": format!("{:x}", output.0.finalize()),
            // Error messages and unknown type names can contain source text.
            "typed_events": parsed.diagnostics.typed_events,
            "fallback_events": parsed.diagnostics.fallback_events,
            "malformed_lines": parsed.diagnostics.malformed_lines,
            "unknown_events": parsed.diagnostics.unknown_event_types.values().sum::<usize>(),
            "deserialization_failures": parsed.diagnostics.deserialization_failures.values().map(|failure| failure.count).sum::<usize>(),
        })
    );
    Ok(())
}
