//! Post-conversation sections: todos, checkpoints, metrics, incidents,
//! custom tables, events summary, diagnostics, and rewind snapshots.

use tracepilot_core::utils::InfallibleWrite;

use crate::document::{
    CheckpointExport, CustomTableExport, IncidentExport, ParseDiagnosticsExport, RawEvent,
    RewindIndex, ShutdownMetrics, TodoExport,
};

use super::format_dt;

pub(super) fn write_todos(md: &mut String, todos: &TodoExport) {
    md.push_line(format_args!("## Todos\n"));

    if todos.items.is_empty() {
        md.push_str("_No todos._\n\n");
        return;
    }

    for item in &todos.items {
        let checkbox = match item.status.as_str() {
            "done" => "[x]",
            _ => "[ ]",
        };
        md.push_line(format_args!(
            "- {} **{}**: {}",
            checkbox, item.id, item.title
        ));
        if let Some(desc) = &item.description
            && !desc.is_empty()
        {
            md.push_line(format_args!("  {}", desc));
        }
    }

    if !todos.deps.is_empty() {
        md.push_str("\n**Dependencies:**\n");
        for dep in &todos.deps {
            md.push_line(format_args!("- {} → {}", dep.todo_id, dep.depends_on));
        }
    }

    md.push('\n');
}

pub(super) fn write_checkpoints(md: &mut String, checkpoints: &[CheckpointExport]) {
    md.push_line(format_args!("## Checkpoints\n"));

    if checkpoints.is_empty() {
        md.push_str("_No checkpoints._\n\n");
        return;
    }

    for cp in checkpoints {
        md.push_line(format_args!("### Checkpoint {}: {}\n", cp.number, cp.title));
        if let Some(content) = &cp.content {
            for line in content.lines() {
                if line.starts_with('#') {
                    md.push_line(format_args!("####{}", line));
                } else {
                    md.push_line(format_args!("{}", line));
                }
            }
            md.push('\n');
        }
    }
}

pub(super) fn write_metrics(md: &mut String, metrics: &ShutdownMetrics) {
    md.push_line(format_args!("## Metrics\n"));

    md.push_line(format_args!("| Metric | Value |"));
    md.push_line(format_args!("|--------|-------|"));

    if let Some(kind) = &metrics.shutdown_type {
        md.push_line(format_args!("| Shutdown Type | {} |", kind));
    }
    if let Some(model) = &metrics.current_model {
        md.push_line(format_args!("| Model | {} |", model));
    }
    if let Some(reqs) = metrics.total_premium_requests {
        md.push_line(format_args!("| Premium Requests | {} |", reqs));
    }
    if let Some(api_ms) = metrics.total_api_duration_ms {
        md.push_line(format_args!("| API Duration | {}ms |", api_ms));
    }
    if let Some(changes) = &metrics.code_changes {
        if let Some(added) = changes.lines_added {
            md.push_line(format_args!("| Lines Added | +{} |", added));
        }
        if let Some(removed) = changes.lines_removed {
            md.push_line(format_args!("| Lines Removed | -{} |", removed));
        }
    }
    md.push('\n');

    if !metrics.model_metrics.is_empty() {
        md.push_line(format_args!("### Model Usage\n"));
        md.push_line(format_args!(
            "| Model | Requests | Input Tokens | Output Tokens | Cache Read | Cache Write |"
        ));
        md.push_line(format_args!(
            "|-------|----------|--------------|---------------|------------|-------------|"
        ));

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

            md.push_line(format_args!(
                "| {} | {} | {} | {} | {} | {} |",
                model, reqs, input, output, cache_r, cache_w
            ));
        }
        md.push('\n');
    }
}

pub(super) fn write_incidents(md: &mut String, incidents: &[IncidentExport]) {
    if incidents.is_empty() {
        return;
    }

    md.push_line(format_args!("## Incidents\n"));
    md.push_line(format_args!("| Time | Type | Severity | Summary |"));
    md.push_line(format_args!("|------|------|----------|---------|"));

    for inc in incidents {
        let time = inc
            .timestamp
            .as_ref()
            .map(format_dt)
            .unwrap_or_else(|| "—".to_string());
        md.push_line(format_args!(
            "| {} | {} | {} | {} |",
            time, inc.event_type, inc.severity, inc.summary
        ));
    }
    md.push('\n');
}

pub(super) fn write_events_summary(md: &mut String, events: &[RawEvent]) {
    md.push_line(format_args!("## Events Summary\n"));
    md.push_line(format_args!("Total events: {}\n", events.len()));

    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for event in events {
        *counts.entry(&event.event_type).or_default() += 1;
    }

    let mut sorted: Vec<_> = counts.into_iter().collect();
    sorted.sort_by_key(|b| std::cmp::Reverse(b.1));

    md.push_line(format_args!("| Event Type | Count |"));
    md.push_line(format_args!("|------------|-------|"));
    for (event_type, count) in sorted {
        md.push_line(format_args!("| `{}` | {} |", event_type, count));
    }
    md.push('\n');
}

pub(super) fn write_diagnostics(md: &mut String, diag: &ParseDiagnosticsExport) {
    md.push_line(format_args!("## Parse Diagnostics\n"));
    md.push_line(format_args!("- Total events: {}", diag.total_events));
    md.push_line(format_args!("- Malformed lines: {}", diag.malformed_lines));
    md.push_line(format_args!(
        "- Unknown event types: {}",
        diag.unknown_event_types
    ));
    md.push_line(format_args!(
        "- Deserialization failures: {}",
        diag.deserialization_failures
    ));
    md.push('\n');
}

pub(super) fn write_rewind_snapshots(md: &mut String, rewind: &RewindIndex) {
    if rewind.snapshots.is_empty() {
        return;
    }
    md.push_line(format_args!("## Rewind Snapshots\n"));
    md.push_line(format_args!(
        "| # | Snapshot ID | Timestamp | Files | Branch | Message |"
    ));
    md.push_line(format_args!(
        "|---|-------------|-----------|-------|--------|---------|"
    ));
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
        md.push_line(format_args!(
            "| {} | `{}` | {} | {} | {} | {} |",
            i + 1,
            &snap.snapshot_id[..snap.snapshot_id.len().min(8)],
            ts,
            files,
            branch,
            msg_truncated
        ));
    }
    md.push('\n');
}

pub(super) fn write_custom_tables(md: &mut String, tables: &[CustomTableExport]) {
    if tables.is_empty() {
        return;
    }
    md.push_line(format_args!("## Custom Tables\n"));
    for table in tables {
        md.push_line(format_args!("### {}\n", table.name));
        if table.rows.is_empty() {
            md.push_line(format_args!("*Empty table*\n"));
            continue;
        }
        md.push_fmt(format_args!("|"));
        for col in &table.columns {
            md.push_fmt(format_args!(" {} |", col));
        }
        md.push_line(format_args!(""));
        md.push_fmt(format_args!("|"));
        for _ in &table.columns {
            md.push_fmt(format_args!("---|"));
        }
        md.push_line(format_args!(""));
        for row in &table.rows {
            md.push_fmt(format_args!("|"));
            for col in &table.columns {
                let val = row
                    .get(col)
                    .map(|v| match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default();
                md.push_fmt(format_args!(" {} |", val));
            }
            md.push_line(format_args!(""));
        }
        md.push('\n');
    }
}
