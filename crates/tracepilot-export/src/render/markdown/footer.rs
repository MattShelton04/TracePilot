//! Post-conversation sections: todos, checkpoints, metrics, incidents,
//! custom tables, events summary, diagnostics, and rewind snapshots.

use tracepilot_core::provider::{CostBasis, CostUnit};
use tracepilot_core::utils::InfallibleWrite;

use crate::document::{
    CheckpointExport, CustomTableExport, IncidentExport, ParseDiagnosticsExport, RawEvent,
    RewindIndex, ShutdownMetrics, TodoExport,
};

use super::{cell, format_dt, format_duration, push_nested_markdown};

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
            push_nested_markdown(md, content, 4);
            md.push('\n');
        }
    }
}

pub(super) fn write_metrics(md: &mut String, metrics: &ShutdownMetrics) {
    md.push_line(format_args!("## Metrics\n"));

    md.push_line(format_args!("| Metric | Value |"));
    md.push_line(format_args!("|--------|-------|"));

    if let Some(kind) = &metrics.shutdown_type {
        md.push_line(format_args!("| Shutdown Type | {} |", cell(kind)));
    }
    if let Some(model) = &metrics.current_model {
        md.push_line(format_args!("| Model | {} |", cell(model)));
    }
    if let Some(nano_aiu) = metrics.total_nano_aiu {
        md.push_line(format_args!(
            "| AI Credits | {:.3} (observed) |",
            nano_aiu as f64 / 1_000_000_000.0
        ));
    } else if let Some(reqs) = metrics.total_premium_requests {
        md.push_line(format_args!(
            "| Legacy Premium Requests | {} (AIC unavailable) |",
            reqs
        ));
    } else if reports_provider_cost(metrics) {
        md.push_line(format_args!("| Est. cost | {} |", provider_cost(metrics)));
    }
    if let Some(api_ms) = metrics.total_api_duration_ms {
        md.push_line(format_args!(
            "| API Duration | {} |",
            format_duration(api_ms)
        ));
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
        // Sources costed in USD have no AI Credits to show.
        let show_aic = !reports_provider_cost(metrics)
            || metrics
                .model_metrics
                .values()
                .any(|detail| detail.total_nano_aiu.is_some());
        md.push_line(format_args!("### Model Usage\n"));
        if show_aic {
            md.push_line(format_args!(
                "| Model | Requests | AI Credits | Input Tokens | Output Tokens | Cache Read | Cache Write |"
            ));
            md.push_line(format_args!(
                "|-------|----------|------------|--------------|---------------|------------|-------------|"
            ));
        } else {
            md.push_line(format_args!(
                "| Model | Requests | Input Tokens | Output Tokens | Cache Read | Cache Write |"
            ));
            md.push_line(format_args!(
                "|-------|----------|--------------|---------------|------------|-------------|"
            ));
        }

        let mut sorted: Vec<_> = metrics.model_metrics.iter().collect();
        sorted.sort_by_key(|(k, _)| k.as_str());

        for (model, detail) in sorted {
            // A model seen only in a provider snapshot has no request count.
            let reqs = detail
                .requests
                .as_ref()
                .and_then(|r| r.count)
                .map_or_else(|| "—".to_string(), |count| count.to_string());
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
            md.push_fmt(format_args!("| {} | {} |", cell(model), reqs));
            if show_aic {
                let ai_credits = detail
                    .total_nano_aiu
                    .map(|value| format!("{:.3}", value as f64 / 1_000_000_000.0))
                    .unwrap_or_else(|| "—".to_string());
                md.push_fmt(format_args!(" {} |", ai_credits));
            }
            md.push_line(format_args!(
                " {} | {} | {} | {} |",
                input, output, cache_r, cache_w
            ));
        }
        md.push('\n');
    }
}

/// Only providers without AI Credits (Claude Code) report a cost figure or
/// its coverage; Copilot sessions keep their AI Credits presentation.
fn reports_provider_cost(metrics: &ShutdownMetrics) -> bool {
    metrics.cost_amount.is_some() || metrics.coverage.is_some()
}

/// The provider's cost as Overview shows it: the amount with its basis, the
/// last snapshot's cost as a lower bound when later calls are unpriced, and
/// whether it covers only part of the session.
fn provider_cost(metrics: &ShutdownMetrics) -> String {
    let coverage = metrics.coverage.as_ref();
    let partial = coverage.is_some_and(|c| c.snapshot_line.is_none() || c.tail_calls > 0);
    let current = match (metrics.cost_amount, metrics.cost_unit, metrics.cost_basis) {
        (Some(amount), Some(unit), Some(basis)) => Some((format_cost(amount, unit), basis)),
        _ => None,
    };
    let lower_bound = || {
        coverage
            .and_then(|c| c.snapshot_cost)
            .map(|s| (format!("≥ {}", format_cost(s.amount, s.unit)), s.basis))
    };
    let Some((value, basis)) = current.or_else(lower_bound) else {
        return "—".to_string();
    };
    let basis = match basis {
        CostBasis::Billed => "billed",
        CostBasis::ProviderEstimate => "provider estimate",
        CostBasis::TracepilotEstimate => "TracePilot estimate",
    };
    if partial {
        format!("{value} ({basis}, partial)")
    } else {
        format!("{value} ({basis})")
    }
}

/// USD to the cent with thousands separators, as the app formats it.
fn format_cost(amount: f64, unit: CostUnit) -> String {
    match unit {
        CostUnit::Aic => format!("{amount:.3} AI Credits"),
        // A nonzero amount below half a cent never reads as $0.00.
        CostUnit::Usd if amount > 0.0 && amount < 0.005 => "< $0.01".to_string(),
        CostUnit::Usd => {
            let cents = format!("{:.2}", amount.abs());
            let (whole, fraction) = cents.split_once('.').unwrap_or((&cents, "00"));
            let mut grouped = String::with_capacity(whole.len() + whole.len() / 3);
            for (i, digit) in whole.chars().enumerate() {
                if i > 0 && (whole.len() - i) % 3 == 0 {
                    grouped.push(',');
                }
                grouped.push(digit);
            }
            let sign = if amount < 0.0 { "-" } else { "" };
            format!("{sign}${grouped}.{fraction}")
        }
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
            time,
            cell(&inc.event_type),
            cell(&inc.severity),
            cell(&inc.summary)
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
    // Most frequent first; equal counts by name, so the same session always
    // exports the same table.
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));

    md.push_line(format_args!("| Event Type | Count |"));
    md.push_line(format_args!("|------------|-------|"));
    for (event_type, count) in sorted {
        md.push_line(format_args!("| `{}` | {} |", cell(event_type), count));
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
        let msg_truncated = tracepilot_core::utils::truncate_utf8(msg, 50);

        md.push_line(format_args!(
            "| {} | `{}` | {} | {} | {} | {} |",
            i + 1,
            tracepilot_core::utils::truncate_utf8(&snap.snapshot_id, 8),
            cell(ts),
            files,
            cell(branch),
            cell(msg_truncated)
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
            md.push_fmt(format_args!(" {} |", cell(col)));
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
                md.push_fmt(format_args!(" {} |", cell(&val)));
            }
            md.push_line(format_args!(""));
        }
        md.push('\n');
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usd_costs_read_as_the_app_shows_them() {
        assert_eq!(format_cost(0.0, CostUnit::Usd), "$0.00");
        assert_eq!(format_cost(0.004, CostUnit::Usd), "< $0.01");
        assert_eq!(format_cost(0.25, CostUnit::Usd), "$0.25");
        assert_eq!(format_cost(1234.5, CostUnit::Usd), "$1,234.50");
        assert_eq!(format_cost(1_000_000.0, CostUnit::Usd), "$1,000,000.00");
    }
}
