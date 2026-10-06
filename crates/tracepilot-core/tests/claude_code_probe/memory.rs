//! Line sizes and what a parse retains, for the reader's memory bounds (C2).
//! Prints byte counts only.

use std::path::Path;

use tracepilot_core::provider::claude_code::ClaudeParse;

const MIB: f64 = 1024.0 * 1024.0;

#[derive(Default)]
pub struct Memory {
    source_bytes: u64,
    max_line: usize,
    lines_over_1mib: usize,
    /// Serialized `raw.data` of mapped events.
    data_bytes: u64,
    /// Serialized `raw.native` of mapped events.
    native_bytes: u64,
    /// Serialized `raw.data` + `raw.native` of native-only events.
    native_only_bytes: u64,
    /// The session with the highest retained bytes: (source, retained).
    largest: (u64, u64),
}

impl Memory {
    pub fn add(&mut self, main: &Path, parsed: &ClaudeParse) {
        let mut files = vec![main.to_path_buf()];
        let subagents = main.with_extension("").join("subagents");
        for entry in std::fs::read_dir(subagents).into_iter().flatten().flatten() {
            if entry.path().extension().is_some_and(|e| e == "jsonl") {
                files.push(entry.path());
            }
        }
        let mut source = 0;
        for file in files {
            let Ok(bytes) = std::fs::read(&file) else {
                continue;
            };
            source += bytes.len() as u64;
            for line in bytes.split(|b| *b == b'\n') {
                self.max_line = self.max_line.max(line.len());
                self.lines_over_1mib += usize::from(line.len() > 1 << 20);
            }
        }
        let size = |v: &serde_json::Value| serde_json::to_vec(v).map_or(0, |b| b.len() as u64);
        let mut retained = 0;
        for event in &parsed.events {
            let data = size(&event.raw.data);
            let native = event.raw.native.as_ref().map_or(0, |n| size(&n.data));
            if event.raw.event_type.contains('.') {
                self.data_bytes += data;
                self.native_bytes += native;
            } else {
                self.native_only_bytes += data + native;
            }
            retained += data + native;
        }
        self.source_bytes += source;
        if retained > self.largest.1 {
            self.largest = (source, retained);
        }
    }

    pub fn print(&self) {
        let mib = |b: u64| b as f64 / MIB;
        println!("\n### Memory shape\n");
        println!(
            "- Source {:.1} MiB; longest line {:.2} MiB; lines over 1 MiB {}",
            mib(self.source_bytes),
            self.max_line as f64 / MIB,
            self.lines_over_1mib
        );
        println!(
            "- Retained (serialized): mapped data {:.1} MiB, mapped natives {:.1} MiB, \
             native-only data + native {:.1} MiB",
            mib(self.data_bytes),
            mib(self.native_bytes),
            mib(self.native_only_bytes)
        );
        let total = self.data_bytes + self.native_bytes + self.native_only_bytes;
        println!(
            "- Retained ÷ source: overall {:.2}; largest session {:.1} MiB from {:.1} MiB source ({:.2})",
            total as f64 / self.source_bytes.max(1) as f64,
            mib(self.largest.1),
            mib(self.largest.0),
            self.largest.1 as f64 / self.largest.0.max(1) as f64
        );
    }
}
