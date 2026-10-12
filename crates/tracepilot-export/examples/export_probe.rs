//! Repeatable synthetic export workload. See the crate README for invocation.
#![allow(clippy::print_stdout, clippy::print_stderr)]

use std::io::{BufWriter, Write};
use std::path::Path;
use std::time::Instant;

use serde_json::json;
use sha2::{Digest, Sha256};
use tracepilot_export::{ExportFormat, ExportOptions, SectionId};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [flag] if flag == "--revision" => {
            println!("{}", revision());
            Ok(())
        }
        [mode, root, turns, result_bytes] if mode == "generate" => {
            generate(Path::new(root), turns.parse()?, result_bytes.parse()?)
        }
        [mode, root, preset] if mode == "measure" => measure(Path::new(root), preset),
        _ => Err("usage: export_probe generate <new-dir> <turns> <result-bytes> | measure <dir> <all-json|sharing-md>".into()),
    }
}

fn revision() -> &'static str {
    option_env!("TRACEPILOT_PROBE_REVISION").unwrap_or("unspecified")
}

/// Four tools per turn with distinct IDs, escaped text, and multibyte output.
/// Use a separate process so fixture construction does not affect peak memory.
fn generate(root: &Path, turns: usize, result_bytes: usize) -> Result<()> {
    std::fs::create_dir(root)?;
    std::fs::write(
        root.join("workspace.yaml"),
        "id: export-benchmark\nsummary: Synthetic export workload\ncreated_at: 2026-01-01T00:00:00Z\n",
    )?;
    let mut file = BufWriter::new(std::fs::File::create(root.join("events.jsonl"))?);
    let mut seq = 0;
    let mut event = |kind: &str, data: serde_json::Value| -> Result<()> {
        seq += 1;
        serde_json::to_writer(
            &mut file,
            &json!({"type": kind, "id": format!("event-{seq}"),
                "timestamp": "2026-01-01T00:00:00Z", "data": data}),
        )?;
        file.write_all(b"\n")?;
        Ok(())
    };
    event("session.start", json!({"sessionId": "export-benchmark"}))?;
    let result = format!(
        "Synthetic \"output\" \\ path — α\n{}",
        "x".repeat(result_bytes)
    );
    for turn in 0..turns {
        let turn_id = format!("turn-{turn}");
        event(
            "user.message",
            json!({"content": format!("Review module {turn}"), "interactionId": turn_id}),
        )?;
        event("assistant.turn_start", json!({"turnId": turn_id}))?;
        for tool in 0..4 {
            let id = format!("tool-{turn}-{tool}");
            event(
                "tool.execution_start",
                json!({"toolCallId": id, "toolName": "view", "arguments": {"path": format!("src/module-{turn}.rs")}}),
            )?;
            event(
                "tool.execution_complete",
                json!({"toolCallId": id, "success": true, "result": {"content": result}}),
            )?;
        }
        event(
            "assistant.message",
            json!({"content": "Review complete.", "turnId": turn_id}),
        )?;
        event("assistant.turn_end", json!({"turnId": turn_id}))?;
    }
    file.flush()?;
    println!(
        "{}",
        json!({"turns": turns, "tool_calls": turns * 4, "events": seq,
        "source_bytes": std::fs::metadata(root.join("events.jsonl"))?.len()})
    );
    Ok(())
}

fn measure(root: &Path, preset: &str) -> Result<()> {
    let options = match preset {
        "all-json" => ExportOptions::all(ExportFormat::Json),
        "sharing-md" => ExportOptions::sharing(ExportFormat::Markdown),
        _ => return Err("unknown preset".into()),
    };
    let started = Instant::now();
    let mut archive = tracepilot_export::builder::build_session_archive(root, &options)?;
    let build_ms = started.elapsed().as_secs_f64() * 1000.0;
    // Freeze volatile header fields and HashSet order for exact output comparison.
    archive.header.exported_at = "2026-01-01T00:00:00Z".parse()?;
    archive.header.exported_by = "TracePilot export probe".into();
    archive
        .export_options
        .included_sections
        .sort_by_key(|section| {
            SectionId::ALL
                .iter()
                .position(|candidate| candidate == section)
        });
    tracepilot_export::content_filter::apply_content_filters(&mut archive, &options.content_detail);
    let render_start = Instant::now();
    let files = tracepilot_export::render::create_renderer(options.format).render(&archive)?;
    let render_ms = render_start.elapsed().as_secs_f64() * 1000.0;
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let peak_rss_kib = peak_rss_kib().ok_or("peak RSS unavailable")?;
    let content = &files[0].content;
    println!(
        "{}",
        json!({"revision": revision(), "preset": preset, "build_ms": build_ms, "render_ms": render_ms,
        "elapsed_ms": elapsed_ms, "peak_rss_kib": peak_rss_kib,
        "output_bytes": content.len(), "output_sha256": format!("{:x}", Sha256::digest(content)),
        "turns": archive.sessions[0].metadata.turn_count})
    );
    Ok(())
}

fn peak_rss_kib() -> Option<u64> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("powershell.exe")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .args(["-NoProfile", "-NonInteractive", "-Command"])
            .arg(format!(
                "(Get-Process -Id {}).PeakWorkingSet64",
                std::process::id()
            ))
            .output()
            .ok()?;
        output.status.success().then_some(())?;
        String::from_utf8(output.stdout)
            .ok()?
            .trim()
            .parse::<u64>()
            .ok()
            .map(|bytes| bytes / 1024)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::fs::read_to_string("/proc/self/status")
            .ok()?
            .lines()
            .find_map(|line| line.strip_prefix("VmHWM:"))
            .and_then(|value| value.trim().trim_end_matches("kB").trim().parse().ok())
    }
}
