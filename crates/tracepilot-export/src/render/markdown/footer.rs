//! Post-conversation sections: todos, checkpoints, metrics, health,
//! incidents, custom tables, events summary, diagnostics, and rewind
//! snapshots.

use std::fmt::Write;

use crate::document::{
    CheckpointExport, CustomTableExport, HealthSeverity, IncidentExport, ParseDiagnosticsExport,
    RawEvent, RewindIndex, SessionHealth, ShutdownMetrics, TodoExport,
};

use super::format_dt;

pub(super) fn write_todos(md: &mut String, todos: &TodoExport) {
    let _ = writeln!(md, "## Todos\n");

    if todos.items.is_empty() {
        md.push_str("_No todos._\n\n");
        return;
    }

    for item in &todos.items {
        let checkbox = match item.status.as_str() {
            "done" => "[x]",
            _ => "[ ]",
        };
        let _ = writeln!(md, "- {} **{}**: {}", checkbox, item.id, item.title);
        if let Some(desc) = &item.description
            && !desc.is_empty()
        {
            let _ = writeln!(md, "  {}", desc);
        }
    }

    if !todos.deps.is_empty() {
        md.push_str("\n**Dependencies:**\n");
        for dep in &todos.deps {
            let _ = writeln!(md, "- {} → {}", dep.todo_id, dep.depends_on);
        }
    }

    md.push('\n');
}

pub(super) fn write_checkpoints(md: &mut String, checkpoints: &[CheckpointExport]) {
    let _ = writeln!(md, "## Checkpoints\n");

    if checkpoints.is_empty() {
        md.push_str("_No checkpoints._\n\n");
        return;
    }

    for cp in checkpoints {
        let _ = writeln!(md, "### Checkpoint {}: {}\n", cp.number, cp.title);
        if let Some(content) = &cp.content {
            for line in content.lines() {
                if line.starts_with('#') {
                    let _ = writeln!(md, "####{}", line);
                } else {
                    let _ = writeln!(md, "{}", line);
                }
            }
            md.push('\n');
        }
    }
}

pub(super) fn write_metrics(md: &mut String, metrics: &ShutdownMetrics) {
    let _ = writeln!(md, "## Metrics\n");

    let _ = writeln!(md, "| Metric | Value |");
    let _ = writeln!(md, "|--------|-------|");

    if let Some(kind) = &metrics.shutdown_type {
        let _ = writeln!(md, "| Shutdown Type | {} |", kind);
    }
    if let Some(model) = &metrics.current_model {
        let _ = writeln!(md, "| Model | {} |", model);
    }
    if let Some(reqs) = metrics.total_premium_requests {
        let _ = writeln!(md, "| Premium Requests | {} |", reqs);
    }
    if let Some(api_ms) = metrics.total_api_duration_ms {
        let _ = writeln!(md, "| API Duration | {}ms |", api_ms);
    }
    if let Some(changes) = &metrics.code_changes {
        if let Some(added) = changes.lines_added {
            let _ = writeln!(md, "| Lines Added | +{} |", added);
        }
        if let Some(removed) = changes.lines_removed {
            let _ = writeln!(md, "| Lines Removed | -{} |", removed);
        }
    }
    md.push('\n');

    if !metrics.model_metrics.is_empty() {
        let _ = writeln!(md, "### Model Usage\n");
        let _ = writeln!(
            md,
            "| Model | Requests | Input Tokens | Output Tokens | Cache Read | Cache Write |"
        );
        let _ = writeln!(
            md,
            "|-------|----------|--------------|---------------|------------|-------------|"
        );

        let mut sorted: Vec<_> = metrics.model_metrics.iter().collect();
        sorted.sort_by_key(|(k, _)| k.as_str());

        for (model, detail) in sorted {
            let reqs = detail.requests.as_ref().and_then(|r| r.count).unwrap_or(0);
            let input = detail
                .usage
                .as_ref()
                .and_then(|u| u.input_tokens)
                .unwrap_or(0);
            let output = detail
                .usage
                .as_ref()
                .and_then(|u| u.output_tokens)
                .unwrap_or(0);
            let cache_r = detail
                .usage
                .as_ref()
                .and_then(|u| u.cache_read_tokens)
                .unwrap_or(0);
            let cache_w = detail
                .usage
                .as_ref()
                .and_then(|u| u.cache_write_tokens)
                .unwrap_or(0);

            let _ = writeln!(
                md,
                "| {} | {} | {} | {} | {} | {} |",
                model, reqs, input, output, cache_r, cache_w
            );
        }
        md.push('\n');
    }
}

pub(super) fn write_health(md: &mut String, health: &SessionHealth) {
    let _ = writeln!(md, "## Health\n");
    let _ = writeln!(md, "**Score:** {:.0}%\n", health.score * 100.0);

    if !health.flags.is_empty() {
        let _ = writeln!(md, "| Severity | Category | Message |");
        let _ = writeln!(md, "|----------|----------|---------|");
        for flag in &health.flags {
            let icon = match flag.severity {
                HealthSeverity::Error => "🔴 Error",
                HealthSeverity::Warning => "🟡 Warning",
                HealthSeverity::Info => "ℹ️ Info",
            };
            let _ = writeln!(md, "| {} | {} | {} |", icon, flag.category, flag.message);
        }
        md.push('\n');
    }
}

pub(super) fn write_incidents(md: &mut String, incidents: &[IncidentExport]) {
    if incidents.is_empty() {
        return;
    }

    let _ = writeln!(md, "## Incidents\n");
    let _ = writeln!(md, "| Time | Type | Severity | Summary |");
    let _ = writeln!(md, "|------|------|----------|---------|");

    for inc in incidents {
        let time = inc
            .timestamp
            .as_ref()
            .map(format_dt)
            .unwrap_or_else(|| "—".to_string());
        let _ = writeln!(
            md,
            "| {} | {} | {} | {} |",
            time, inc.event_type, inc.severity, inc.summary
        );
    }
    md.push('\n');
}

pub(super) fn write_events_summary(md: &mut String, events: &[RawEvent]) {
    let _ = writeln!(md, "## Events Summary\n");
    let _ = writeln!(md, "Total events: {}\n", events.len());

    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for event in events {
        *counts.entry(&event.event_type).or_default() += 1;
    }

    let mut sorted: Vec<_> = counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));

    let _ = writeln!(md, "| Event Type | Count |");
    let _ = writeln!(md, "|------------|-------|");
    for (event_type, count) in sorted {
        let _ = writeln!(md, "| `{}` | {} |", event_type, count);
    }
    md.push('\n');
}

pub(super) fn write_diagnostics(md: &mut String, diag: &ParseDiagnosticsExport) {
    let _ = writeln!(md, "## Parse Diagnostics\n");
    let _ = writeln!(md, "- Total events: {}", diag.total_events);
    let _ = writeln!(md, "- Malformed lines: {}", diag.malformed_lines);
    let _ = writeln!(md, "- Unknown event types: {}", diag.unknown_event_types);
    let _ = writeln!(
        md,
        "- Deserialization failures: {}",
        diag.deserialization_failures
    );
    md.push('\n');
}

pub(super) fn write_rewind_snapshots(md: &mut String, rewind: &RewindIndex) {
    if rewind.snapshots.is_empty() {
        return;
    }
    let _ = writeln!(md, "## Rewind Snapshots\n");
    let _ = writeln!(md, "| # | Snapshot ID | Timestamp | Files | Branch | Message |");
    let _ = writeln!(md, "|---|-------------|-----------|-------|--------|---------|");
    for (i, snap) in rewind.snapshots.iter().enumerate() {
        let ts = snap.timestamp.as_deref().unwrap_or("—");
        let files = snap.file_count.map(|n| n.to_string()).unwrap_or_else(|| "—".to_string());
        let branch = snap.git_branch.as_deref().unwrap_or("—");
        let msg = snap.user_message.as_deref().unwrap_or("—");
        let msg_truncated = if msg.len() > 50 { &msg[..msg.floor_char_boundary(50)] } else { msg };
        let _ = writeln!(md, "| {} | `{}` | {} | {} | {} | {} |",
            i + 1,
            &snap.snapshot_id[..snap.snapshot_id.len().min(8)],
            ts,
            files,
            branch,
            msg_truncated
        );
    }
    md.push('\n');
}

pub(super) fn write_custom_tables(md: &mut String, tables: &[CustomTableExport]) {
    if tables.is_empty() {
        return;
    }
    let _ = writeln!(md, "## Custom Tables\n");
    for table in tables {
        let _ = writeln!(md, "### {}\n", table.name);
        if table.rows.is_empty() {
            let _ = writeln!(md, "*Empty table*\n");
            continue;
        }
        let _ = write!(md, "|");
        for col in &table.columns {
            let _ = write!(md, " {} |", col);
        }
        let _ = writeln!(md);
        let _ = write!(md, "|");
        for _ in &table.columns {
            let _ = write!(md, "---|");
        }
        let _ = writeln!(md);
        for row in &table.rows {
            let _ = write!(md, "|");
            for col in &table.columns {
                let val = row.get(col)
                    .map(|v| match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default();
                let _ = write!(md, " {} |", val);
            }
            let _ = writeln!(md);
        }
        md.push('\n');
    }
}
