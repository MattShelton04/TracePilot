use chrono::{Duration as ChronoDuration, TimeZone, Utc};
use serde_json::{Value, json};
use std::fs::OpenOptions;
use std::io::{BufWriter, Write};
use std::path::Path;
use tracepilot_indexer::reindex_all;

use super::model::{
    AnyError, FIXTURE_VERSION, FixtureManifest, MANIFEST_FILE, MARKER_FILE, ManifestSession,
    ManifestTotals, SEARCH_SENTINEL, STRESS_LABEL, Scale, StableSentinels, UUID_BASE,
};
use super::validate::{count_files, create_new_json, create_new_text, fail};

#[derive(Debug)]
struct SessionSpec {
    id: String,
    title: String,
    profile: &'static str,
    event_count: usize,
    turn_count: usize,
    tool_call_count: usize,
    stress_output: bool,
}

pub(super) fn generate_corpus(root: &Path, scale: Scale) -> Result<FixtureManifest, AnyError> {
    ensure_empty_target(root)?;
    std::fs::create_dir_all(root)?;
    create_new_text(
        &root.join(MARKER_FILE),
        &format!("tracepilot-performance-corpus\nfixture-version={FIXTURE_VERSION}\n"),
    )?;

    let sessions_root = root.join("copilot").join("session-state");
    let tracepilot_root = root.join("tracepilot");
    std::fs::create_dir_all(&sessions_root)?;
    std::fs::create_dir_all(&tracepilot_root)?;

    let specs = build_specs(scale)?;
    let mut sessions = Vec::with_capacity(specs.len());
    for (index, spec) in specs.iter().enumerate() {
        let session_dir = sessions_root.join(&spec.id);
        std::fs::create_dir(&session_dir)?;
        create_new_text(
            &session_dir.join("workspace.yaml"),
            &workspace_yaml(spec, index),
        )?;
        let stress_bytes = write_events(&session_dir.join("events.jsonl"), spec, index)?;
        sessions.push(ManifestSession {
            id: spec.id.clone(),
            title: spec.title.clone(),
            profile: spec.profile.to_string(),
            event_count: spec.event_count,
            turn_count: spec.turn_count,
            tool_call_count: spec.tool_call_count,
            expected_search_matches: spec.turn_count,
            stress_bytes,
        });
    }

    create_new_text(&tracepilot_root.join("config.toml"), &config_toml(root))?;

    let db_path = tracepilot_root.join("index.db");
    let indexed = reindex_all(&sessions_root, &db_path)?;
    if indexed != sessions.len() {
        return fail(format!(
            "initial full index handled {indexed} sessions, expected {}",
            sessions.len()
        ));
    }
    let (search_indexed, search_skipped) =
        tracepilot_indexer::reindex_search_content(&sessions_root, &db_path, |_| {}, || false)?;
    if (search_indexed, search_skipped) != (sessions.len(), 0) {
        return fail(format!(
            "initial search index result was ({search_indexed}, {search_skipped}), expected ({}, 0)",
            sessions.len()
        ));
    }

    // SQLite schema migrations retain versioned safety backups. Count the
    // files actually produced by this fixture version, plus the manifest that
    // is written immediately below, rather than assuming only one DB file.
    let generated_file_count = count_files(root)? + 1;
    let totals = ManifestTotals {
        session_count: sessions.len(),
        event_count: sessions.iter().map(|s| s.event_count).sum(),
        turn_count: sessions.iter().map(|s| s.turn_count).sum(),
        tool_call_count: sessions.iter().map(|s| s.tool_call_count).sum(),
        expected_search_matches: sessions.iter().map(|s| s.expected_search_matches).sum(),
        stress_bytes: sessions.iter().map(|s| s.stress_bytes).sum(),
        file_count: generated_file_count,
    };
    let manifest = FixtureManifest {
        fixture_version: FIXTURE_VERSION,
        generator: "tracepilot-bench/performance_probe".to_string(),
        scale: scale.name().to_string(),
        root: root.to_string_lossy().to_string(),
        stable_sentinels: StableSentinels {
            search_term: SEARCH_SENTINEL.to_string(),
            stress_label: STRESS_LABEL.to_string(),
        },
        sessions,
        totals,
    };
    create_new_json(&root.join(MANIFEST_FILE), &manifest)?;

    let actual_files = count_files(root)?;
    if actual_files != manifest.totals.file_count {
        return fail(format!(
            "generated file count {actual_files} did not match manifest {}",
            manifest.totals.file_count
        ));
    }
    Ok(manifest)
}

fn ensure_empty_target(root: &Path) -> Result<(), AnyError> {
    if !root.exists() {
        return Ok(());
    }
    if !root.is_dir() {
        return fail(format!(
            "target exists and is not a directory: {}",
            root.display()
        ));
    }
    if std::fs::read_dir(root)?.next().is_some() {
        return fail(format!(
            "refusing to overwrite non-empty target; choose a new corpus root: {}",
            root.display()
        ));
    }
    Ok(())
}

fn build_specs(scale: Scale) -> Result<Vec<SessionSpec>, AnyError> {
    let count = scale.session_count();
    let mut specs = Vec::with_capacity(count);
    let ordinary_events = [34usize, 50, 82, 130, 258];
    for index in 0..count {
        let (profile, event_count, turn_count, stress_output) = if index + 1 == count {
            if matches!(scale, Scale::Large) {
                ("stress-20k-events", 20_000, 800, true)
            } else {
                ("stress-5k-events", 5_000, 400, true)
            }
        } else if index + 2 == count {
            if matches!(scale, Scale::Large) {
                ("stress-5k-events", 5_000, 400, false)
            } else {
                ("detailed-200-turn", 1_600, 200, false)
            }
        } else if index + 3 == count && matches!(scale, Scale::Large) {
            ("detailed-200-turn", 1_600, 200, false)
        } else {
            let events = ordinary_events[index % ordinary_events.len()];
            ("ordinary", events, ((events - 2) / 8).max(1), false)
        };
        let fixed_events = 2 + 4 * turn_count;
        if event_count < fixed_events || (event_count - fixed_events) % 2 != 0 {
            return fail(format!("invalid event/turn plan for session {index}"));
        }
        let tool_call_count = (event_count - fixed_events) / 2;
        let id = uuid::Uuid::from_u128(UUID_BASE + index as u128).to_string();
        specs.push(SessionSpec {
            id,
            title: format!("Synthetic {} {} session {index:04}", scale.name(), profile),
            profile,
            event_count,
            turn_count,
            tool_call_count,
            stress_output,
        });
    }
    Ok(specs)
}

fn workspace_yaml(spec: &SessionSpec, index: usize) -> String {
    let day = index % 28 + 1;
    format!(
        "id: {}\nname: {:?}\nuser_named: false\nsummary_count: 0\ncwd: C:/synthetic/tracepilot-workload\ngit_root: C:/synthetic/tracepilot-workload\nrepository: github.com/example/tracepilot-synthetic\nbranch: perf-fixture\nhost_type: cli\ncreated_at: \"2026-01-{day:02}T08:00:00Z\"\nupdated_at: \"2026-01-{day:02}T09:00:00Z\"\n",
        spec.id, spec.title
    )
}

fn write_events(path: &Path, spec: &SessionSpec, session_index: usize) -> Result<usize, AnyError> {
    let file = OpenOptions::new().create_new(true).write(true).open(path)?;
    let mut writer = BufWriter::new(file);
    let base = Utc
        .with_ymd_and_hms(2026, 1, 1, 8, 0, 0)
        .single()
        .ok_or_else(|| std::io::Error::other("invalid fixed fixture timestamp"))?
        + ChronoDuration::days((session_index % 28) as i64);
    let mut sequence = 0usize;
    let mut event_index = 0usize;
    let mut write_event = |event_type: &str, data: Value| -> Result<(), AnyError> {
        sequence += 1;
        event_index += 1;
        let timestamp = (base + ChronoDuration::seconds(sequence as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        serde_json::to_writer(
            &mut writer,
            &json!({
                "type": event_type,
                "data": data,
                "id": format!("{}-e{event_index:06}", spec.id),
                "timestamp": timestamp
            }),
        )?;
        writer.write_all(b"\n")?;
        Ok(())
    };

    write_event(
        "session.start",
        json!({
            "sessionId": spec.id,
            "version": "1.0.83",
            "producer": "copilot-cli",
            "copilotVersion": "1.0.83",
            "selectedModel": "claude-sonnet-4.5",
            "context": {
                "cwd": "C:/synthetic/tracepilot-workload",
                "gitRoot": "C:/synthetic/tracepilot-workload",
                "repository": "github.com/example/tracepilot-synthetic",
                "branch": "perf-fixture",
                "hostType": "cli"
            }
        }),
    )?;

    let base_tools = spec.tool_call_count / spec.turn_count;
    let extra_tools = spec.tool_call_count % spec.turn_count;
    let mut tool_ordinal = 0usize;
    let stress_ordinal = spec.stress_output.then_some(spec.tool_call_count / 2);
    let mut stress_bytes = 0usize;

    for turn_index in 0..spec.turn_count {
        let turn_id = format!("{}-turn-{turn_index:05}", spec.id);
        let interaction_id = format!("{}-interaction-{turn_index:05}", spec.id);
        write_event(
            "user.message",
            json!({
                "content": user_message(turn_index),
                "interactionId": interaction_id,
                "messageId": format!("user-{turn_index:05}"),
                "turnId": turn_id
            }),
        )?;
        write_event(
            "assistant.turn_start",
            json!({
                "turnId": turn_id,
                "interactionId": interaction_id,
                "model": "claude-sonnet-4.5"
            }),
        )?;
        write_event(
            "assistant.message",
            json!({
                "content": assistant_message(turn_index),
                "messageId": format!("assistant-{turn_index:05}"),
                "interactionId": interaction_id,
                "turnId": turn_id,
                "model": "claude-sonnet-4.5"
            }),
        )?;

        let tools_this_turn = base_tools + usize::from(turn_index < extra_tools);
        for local_tool in 0..tools_this_turn {
            let tool_name = tool_name(tool_ordinal);
            let call_id = format!("{}-tool-{tool_ordinal:06}", spec.id);
            write_event(
                "tool.execution_start",
                json!({
                    "toolName": tool_name,
                    "toolCallId": call_id,
                    "turnId": turn_id,
                    "arguments": tool_arguments(tool_name, turn_index, local_tool)
                }),
            )?;
            let result = if stress_ordinal == Some(tool_ordinal) {
                let value = format!("{STRESS_LABEL}\n{}", "x".repeat(1024 * 1024));
                stress_bytes = value.len();
                value
            } else {
                tool_result(tool_name, turn_index, local_tool)
            };
            write_event(
                "tool.execution_complete",
                json!({
                    "toolCallId": call_id,
                    "result": result,
                    "success": true,
                    "turnId": turn_id,
                    "interactionId": interaction_id,
                    "toolTelemetry": {"durationMs": 5 + (tool_ordinal % 97)}
                }),
            )?;
            tool_ordinal += 1;
        }
        write_event(
            "assistant.turn_end",
            json!({"turnId": turn_id, "model": "claude-sonnet-4.5"}),
        )?;
    }

    write_event(
        "session.shutdown",
        json!({
            "shutdownType": "routine",
            "totalPremiumRequests": spec.turn_count as f64,
            "totalApiDurationMs": spec.turn_count as u64 * 850,
            "sessionStartTime": base.timestamp_millis() as u64,
            "currentModel": "claude-sonnet-4.5",
            "currentTokens": spec.turn_count as u64 * 900,
            "codeChanges": {
                "linesAdded": spec.turn_count * 7,
                "linesRemoved": spec.turn_count * 2,
                "filesModified": ["src/service.rs", "src/index.rs", "tests/service.rs"]
            },
            "modelMetrics": {
                "claude-sonnet-4.5": {
                    "requests": {"count": spec.turn_count, "cost": spec.turn_count as f64 * 0.02},
                    "usage": {
                        "inputTokens": spec.turn_count * 600,
                        "outputTokens": spec.turn_count * 300,
                        "cacheReadTokens": spec.turn_count * 250,
                        "cacheWriteTokens": spec.turn_count * 25
                    }
                }
            }
        }),
    )?;
    writer.flush()?;

    if event_index != spec.event_count || tool_ordinal != spec.tool_call_count {
        return fail(format!(
            "generator count mismatch for {}: events {event_index}/{}, tools {tool_ordinal}/{}",
            spec.id, spec.event_count, spec.tool_call_count
        ));
    }
    Ok(stress_bytes)
}

fn user_message(turn: usize) -> String {
    match turn % 4 {
        0 => format!("Please refactor service module {turn} and keep its public behavior stable."),
        1 => format!(
            "Please refactor the request pipeline for case {turn}. Check error propagation, cancellation, and deterministic ordering before updating the implementation."
        ),
        2 => format!(
            "Please refactor this Rust example and explain the result:\n```rust\nfn case_{turn}(value: usize) -> usize {{\n    value.saturating_add(1)\n}}\n```"
        ),
        _ => format!(
            "Please refactor workload {turn}. The acceptance notes require stable IDs, explicit failures, bounded output, and a regression check with representative tool activity."
        ),
    }
}

fn assistant_message(turn: usize) -> String {
    match turn % 3 {
        0 => format!("I’ll inspect the module and trace the call sites for workload {turn}."),
        1 => format!(
            "I found the relevant boundary for workload {turn}; I’ll update it and verify the result."
        ),
        _ => format!("The implementation for workload {turn} is ready for focused validation."),
    }
}

fn tool_name(ordinal: usize) -> &'static str {
    const TOOLS: &[&str] = &["view", "grep", "powershell", "edit", "glob", "create"];
    TOOLS[ordinal % TOOLS.len()]
}

fn tool_arguments(tool: &str, turn: usize, local: usize) -> Value {
    match tool {
        "grep" => json!({"pattern": "Result<", "path": format!("src/module_{turn}")}),
        "powershell" => json!({"command": format!("cargo test focused_case_{turn}_{local}")}),
        "glob" => json!({"pattern": format!("src/module_{turn}/**/*.rs")}),
        _ => json!({"path": format!("src/module_{turn}/file_{local}.rs")}),
    }
}

fn tool_result(tool: &str, turn: usize, local: usize) -> String {
    match tool {
        "grep" => format!("src/module_{turn}/file_{local}.rs:42: Result<(), ServiceError>"),
        "powershell" => {
            format!("running 1 test\ntest focused_case_{turn}_{local} ... ok\ntest result: ok")
        }
        "view" => {
            format!("pub fn workload_{turn}_{local}() -> Result<(), ServiceError> {{ Ok(()) }}")
        }
        "edit" | "create" => {
            format!("Updated src/module_{turn}/file_{local}.rs successfully")
        }
        _ => format!("src/module_{turn}/file_{local}.rs"),
    }
}

fn config_toml(root: &Path) -> String {
    let copilot_home = root.join("copilot");
    let sessions = copilot_home.join("session-state");
    let tracepilot_home = root.join("tracepilot");
    let index = tracepilot_home.join("index.db");
    format!(
        "version = 11\n\n[paths]\ncopilotHome = {}\ntracepilotHome = {}\nsessionStateDir = {}\nindexDbPath = {}\n\n[general]\nautoIndexOnLaunch = false\ncliCommand = \"copilot\"\nsetupComplete = true\n\n[ui]\ntheme = \"dark\"\nhideEmptySessions = true\nautoRefreshEnabled = false\nautoRefreshIntervalSeconds = 5\ncheckForUpdates = false\nfavouriteModels = []\nrecentRepoPaths = []\ncontentMaxWidth = 1600\nuiScale = 1.0\n\n[features]\nexportView = false\nsessionReplay = false\nrenderMarkdown = true\nmcpServers = false\nskills = true\ncopilotSdk = false\nexactContextCapture = false\nconfigInjector = false\npromptCacheInsights = true\nagents = true\n",
        toml_string(&copilot_home),
        toml_string(&tracepilot_home),
        toml_string(&sessions),
        toml_string(&index)
    )
}

fn toml_string(path: &Path) -> String {
    serde_json::to_string(&path.to_string_lossy()).unwrap_or_else(|_| "\"\"".to_string())
}
