//! H1/H2 investigation. Only counts, sums and correlations leave this module.
//! It operates on S3's already-parsed input and never opens a file itself.

use std::collections::{BTreeMap, BTreeSet};

use tracepilot_core::provider::claude_code::{ClaudeParse, sum_calls_by_model};

#[derive(Default)]
pub struct Hypotheses {
    // (away summaries, distinct titles) -> (rows, residual token categories).
    h1: BTreeMap<(usize, usize), (usize, [u64; 4])>,
    h2: BTreeMap<&'static str, u64>,
}

impl Hypotheses {
    pub fn add(&mut self, parsed: &ClaudeParse) {
        let Some(snapshot) = parsed.cost_snapshots.last() else {
            return;
        };
        let covered: Vec<_> = parsed
            .calls
            .iter()
            .filter(|c| c.snapshot_anchor.is_some_and(|a| a < snapshot.line))
            .collect();
        let sums = sum_calls_by_model(covered.iter().copied());
        let mut seen = BTreeSet::new();
        let mut titles = BTreeSet::new();
        let mut away = 0;
        let mut compaction = false;
        let mut notes = BTreeMap::new();
        for (e, p) in parsed.events.iter().zip(&parsed.positions) {
            let Some(p) = p else { continue };
            if p.file_agent_id.is_some() || p.line >= snapshot.line {
                continue;
            }
            if e.raw.event_type == "session.compaction_complete" {
                compaction = true;
            }
            if e.raw.event_type.starts_with("subagent.")
                && let (Some(agent), Some(tokens)) =
                    (&e.raw.agent_id, e.raw.data["totalTokens"].as_u64())
            {
                notes.insert(agent.clone(), tokens);
            }
            if !seen.insert(p.line) {
                continue;
            }
            if let Some(n) = &e.raw.native {
                if n.record_type == "system:away_summary" {
                    away += 1;
                }
                if n.record_type == "ai-title"
                    && let Some(title) = n.data["aiTitle"].as_str()
                {
                    titles.insert(title);
                }
            }
        }
        if !compaction {
            for (model, snap) in &snapshot.model_usage {
                let Some(tr) = sums.get(model) else { continue };
                let tr_tokens = [
                    tr.input_tokens,
                    tr.cache_read_tokens,
                    tr.cache_write_tokens,
                    tr.output_tokens,
                ];
                let sn_tokens = [
                    snap.input_tokens,
                    snap.cache_read_input_tokens,
                    snap.cache_creation_input_tokens,
                    snap.output_tokens,
                ];
                if tr_tokens == sn_tokens || tr_tokens.iter().zip(sn_tokens).any(|(t, s)| *t > s) {
                    continue;
                }
                let residual = std::array::from_fn::<_, 4, _>(|i| sn_tokens[i] - tr_tokens[i]);
                if covered.iter().any(|c| c.agent_id.is_some()) {
                    *self
                        .h2
                        .entry("unexplained session-model rows with subagents")
                        .or_default() += 1;
                    *self.h2.entry("residual output in those rows").or_default() += residual[3];
                } else {
                    let group = self.h1.entry((away, titles.len())).or_default();
                    group.0 += 1;
                    for (total, n) in group.1.iter_mut().zip(residual) {
                        *total += n;
                    }
                }
            }
        }
        for (agent, tokens) in notes {
            let calls: Vec<_> = covered
                .iter()
                .copied()
                .filter(|c| c.agent_id.as_ref() == Some(&agent))
                .collect();
            if calls.is_empty() {
                *self
                    .h2
                    .entry("notifications with no covered transcript calls")
                    .or_default() += 1;
                continue;
            }
            let inclusive: u64 = calls
                .iter()
                .map(|c| c.inclusive_input() + c.output_tokens)
                .sum();
            let uncached: u64 = calls.iter().map(|c| c.input_tokens + c.output_tokens).sum();
            let last = calls
                .last()
                .map_or(0, |c| c.inclusive_input() + c.output_tokens);
            for (key, n) in [
                ("covered agents with notification usage", 1),
                ("notification tokens", tokens),
                ("transcript inclusive input + output", inclusive),
                ("transcript uncached input + output", uncached),
                ("last call inclusive input + output", last),
                (
                    "notifications equal all-call inclusive tokens",
                    u64::from(tokens == inclusive),
                ),
                (
                    "notifications equal all-call uncached tokens",
                    u64::from(tokens == uncached),
                ),
                (
                    "notifications equal last-call tokens",
                    u64::from(tokens == last),
                ),
                (
                    "notifications below all-call inclusive tokens",
                    u64::from(tokens < inclusive),
                ),
                (
                    "notifications above all-call inclusive tokens",
                    u64::from(tokens > inclusive),
                ),
            ] {
                *self.h2.entry(key).or_default() += n;
            }
        }
    }

    pub fn print(&self) {
        println!("\n### C5 residual hypotheses (no adjustments)\n");
        println!(
            "H1: unexplained rows without subagents/compaction; grouped by covered record counts."
        );
        println!(
            "| Away summaries | Distinct titles | Rows | residual input | cache read | cache write | output |"
        );
        println!("| ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
        for ((away, titles), (rows, tokens)) in &self.h1 {
            println!(
                "| {away} | {titles} | {rows} | {} | {} | {} | {} |",
                tokens[0], tokens[1], tokens[2], tokens[3]
            );
        }
        println!("H2: de-duplicated notification usage compared with covered subagent calls.");
        for (key, count) in &self.h2 {
            println!("- {key}: {count}");
        }
    }
}
