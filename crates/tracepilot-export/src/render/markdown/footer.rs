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
    writeln!(md, "## Todos\n").expect("writeln to String is infallible");

    if todos.items.is_empty() {
        md.push_str("_No todos._\n\n");
        return;
    }

    for item in &todos.items {
        let checkbox = match item.status.as_str() {
            "done" => "[x]",
            _ => "[ ]",
        };
        writeln!(md, "- {} **{}**: {}", checkbox, item.id, item.title)
            .expect("writeln to String is infallible");
        if let Some(desc) = &item.description
            && !desc.is_empty()
        {
            writeln!(md, "  {}", desc).expect("writeln to String is infallible");
        }
    }

    if !todos.deps.is_empty() {
        md.push_str("\n**Dependencies:**\n");
        for dep in &todos.deps {
            writeln!(md, "- {} → {}", dep.todo_id, dep.depends_on)
                .expect("writeln to String is infallible");
        }
    }

    md.push('\n');
}

pub(super) fn write_checkpoints(md: &mut String, checkpoints: &[CheckpointExport]) {
    writeln!(md, "## Checkpoints\n").expect("writeln to String is infallible");

    if checkpoints.is_empty() {
        md.push_str("_No checkpoints._\n\n");
        return;
    }

    for cp in checkpoints {
        writeln!(md, "### Checkpoint {}: {}\n", cp.number, cp.title)
            .expect("writeln to String is infallible");
        if let Some(content) = &cp.content {
            for line in content.lines() {
                if line.starts_with('#') {
                    writeln!(md, "####{}", line).expect("writeln to String is infallible");
                } else {
                    writeln!(md, "{}", line).expect("writeln to String is infallible");
                }
            }
            md.push('\n');
        }
    }
}

pub(super) fn write_metrics(md: &mut String, metrics: &ShutdownMetrics) {
    writeln!(md, "## Metrics\n").expect("writeln to String is infallible");

    writeln!(md, "| Metric | Value |").expect("writeln to String is infallible");
    writeln!(md, "|--------|-------|").expect("writeln to String is infallible");

    if let Some(kind) = &metrics.shutdown_type {
        writeln!(md, "| Shutdown Type | {} |", kind).expect("writeln to String is infallible");
    }
    if let Some(model) = &metrics.current_model {
        writeln!(md, "| Model | {} |", model).expect("writeln to String is infallible");
    }
    if let Some(reqs) = metrics.total_premium_requests {
        writeln!(md, "| Premium Requests | {} |", reqs).expect("writeln to String is infallible");
    }
    if let Some(api_ms) = metrics.total_api_duration_ms {
        writeln!(md, "| API Duration | {}ms |", api_ms).expect("writeln to String is infallible");
    }
    if let Some(changes) = &metrics.code_changes {
        if let Some(added) = changes.lines_added {
            writeln!(md, "| Lines Added | +{} |", added).expect("writeln to String is infallible");
        }
        if let Some(removed) = changes.lines_removed {
            writeln!(md, "| Lines Removed | -{} |", removed)
                .expect("writeln to String is infallible");
        }
    }
    md.push('\n');

    if !metrics.model_metrics.is_empty() {
        writeln!(md, "### Model Usage\n").expect("writeln to String is infallible");
        writeln!(
            md,
            "| Model | Requests | Input Tokens | Output Tokens | Cache Read | Cache Write |"
        )
        .expect("writeln to String is infallible");
        writeln!(
            md,
            "|-------|----------|--------------|---------------|------------|-------------|"
        )
        .expect("writeln to String is infallible");

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

            writeln!(
                md,
                "| {} | {} | {} | {} | {} | {} |",
                model, reqs, input, output, cache_r, cache_w
            )
            .expect("writeln to String is infallible");
        }
        md.push('\n');
    }
}

pub(super) fn write_health(md: &mut String, health: &SessionHealth) {
    writeln!(md, "## Health\n").expect("writeln to String is infallible");
    writeln!(md, "**Score:** {:.0}%\n", health.score * 100.0)
        .expect("writeln to String is infallible");

    if !health.flags.is_empty() {
        writeln!(md, "| Severity | Category | Message |").expect("writeln to String is infallible");
        writeln!(md, "|----------|----------|---------|").expect("writeln to String is infallible");
        for flag in &health.flags {
            let icon = match flag.severity {
                HealthSeverity::Error => "🔴 Error",
                HealthSeverity::Warning => "🟡 Warning",
                HealthSeverity::Info => "ℹ️ Info",
            };
            writeln!(md, "| {} | {} | {} |", icon, flag.category, flag.message)
                .expect("writeln to String is infallible");
        }
        md.push('\n');
    }
}

pub(super) fn write_incidents(md: &mut String, incidents: &[IncidentExport]) {
    if incidents.is_empty() {
        return;
    }

    writeln!(md, "## Incidents\n").expect("writeln to String is infallible");
    writeln!(md, "| Time | Type | Severity | Summary |").expect("writeln to String is infallible");
    writeln!(md, "|------|------|----------|---------|").expect("writeln to String is infallible");

    for inc in incidents {
        let time = inc
            .timestamp
            .as_ref()
            .map(format_dt)
            .unwrap_or_else(|| "—".to_string());
        writeln!(
            md,
            "| {} | {} | {} | {} |",
            time, inc.event_type, inc.severity, inc.summary
        )
        .expect("writeln to String is infallible");
    }
    md.push('\n');
}

pub(super) fn write_events_summary(md: &mut String, events: &[RawEvent]) {
    writeln!(md, "## Events Summary\n").expect("writeln to String is infallible");
    writeln!(md, "Total events: {}\n", events.len()).expect("writeln to String is infallible");

    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for event in events {
        *counts.entry(&event.event_type).or_default() += 1;
    }

    let mut sorted: Vec<_> = counts.into_iter().collect();
    sorted.sort_by_key(|b| std::cmp::Reverse(b.1));

    writeln!(md, "| Event Type | Count |").expect("writeln to String is infallible");
    writeln!(md, "|------------|-------|").expect("writeln to String is infallible");
    for (event_type, count) in sorted {
        writeln!(md, "| `{}` | {} |", event_type, count).expect("writeln to String is infallible");
    }
    md.push('\n');
}

pub(super) fn write_diagnostics(md: &mut String, diag: &ParseDiagnosticsExport) {
    writeln!(md, "## Parse Diagnostics\n").expect("writeln to String is infallible");
    writeln!(md, "- Total events: {}", diag.total_events).expect("writeln to String is infallible");
    writeln!(md, "- Malformed lines: {}", diag.malformed_lines)
        .expect("writeln to String is infallible");
    writeln!(md, "- Unknown event types: {}", diag.unknown_event_types)
        .expect("writeln to String is infallible");
    writeln!(
        md,
        "- Deserialization failures: {}",
        diag.deserialization_failures
    )
    .expect("writeln to String is infallible");
    md.push('\n');
}

pub(super) fn write_rewind_snapshots(md: &mut String, rewind: &RewindIndex) {
    if rewind.snapshots.is_empty() {
        return;
    }
    writeln!(md, "## Rewind Snapshots\n").expect("writeln to String is infallible");
    writeln!(
        md,
        "| # | Snapshot ID | Timestamp | Files | Branch | Message |"
    )
    .expect("writeln to String is infallible");
    writeln!(
        md,
        "|---|-------------|-----------|-------|--------|---------|"
    )
    .expect("writeln to String is infallible");
    for (i, snap) in rewind.snapshots.iter().enumerate() {
        let ts = snap.timestamp.as_deref().unwrap_or("—");
        let files = snap
            .file_count
            .map(|n| n.to_string())
            .unwrap_or_else(|| "—".to_string());
        let branch = snap.git_branch.as_deref().unwrap_or("—");
        let msg = snap.user_message.as_deref().unwrap_or("—");
        let msg_truncated = if msg.len() > 50 {
            &msg[..msg.floor_char_boundary(50)]
        } else {
            msg
        };
        writeln!(
            md,
            "| {} | `{}` | {} | {} | {} | {} |",
            i + 1,
            &snap.snapshot_id[..snap.snapshot_id.len().min(8)],
            ts,
            files,
            branch,
            msg_truncated
        )
        .expect("writeln to String is infallible");
    }
    md.push('\n');
}

pub(super) fn write_custom_tables(md: &mut String, tables: &[CustomTableExport]) {
    if tables.is_empty() {
        return;
    }
    writeln!(md, "## Custom Tables\n").expect("writeln to String is infallible");
    for table in tables {
        writeln!(md, "### {}\n", table.name).expect("writeln to String is infallible");
        if table.rows.is_empty() {
            writeln!(md, "*Empty table*\n").expect("writeln to String is infallible");
            continue;
        }
        write!(md, "|").expect("write to String is infallible");
        for col in &table.columns {
            write!(md, " {} |", col).expect("write to String is infallible");
        }
        writeln!(md).expect("writeln to String is infallible");
        write!(md, "|").expect("write to String is infallible");
        for _ in &table.columns {
            write!(md, "---|").expect("write to String is infallible");
        }
        writeln!(md).expect("writeln to String is infallible");
        for row in &table.rows {
            write!(md, "|").expect("write to String is infallible");
            for col in &table.columns {
                let val = row
                    .get(col)
                    .map(|v| match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default();
                write!(md, " {} |", val).expect("write to String is infallible");
            }
            writeln!(md).expect("writeln to String is infallible");
        }
        md.push('\n');
    }
}
