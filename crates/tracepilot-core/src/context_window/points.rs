use super::contributions::estimate_tokens;
use super::model::{
    Anchor, CompactionDraft, ContextCompaction, ContextPointPhase, ContextPointSource,
    ContextWindowPoint, TurnDelta,
};
use crate::models::event_types::{CompactionCompleteData, CompactionStartData, ShutdownData};

pub(super) const TOTAL_ONLY_METHODOLOGY: &str = "Main-agent model calls record inclusive input tokens: uncached input plus cache reads and writes. Each turn's last call is an observed total; its layers are estimates. System & tools is the first request's input beyond the conversation it sent (system prompt, tool definitions and persistent instructions), held for the session. The rest of each total is conversation, split into messages and tool calls & results by the share of each in the main-agent transcript text sent so far (ceil UTF-8 bytes / 4), reset to the summary at each compaction. Text the transcript does not record, such as injected reminders and re-attached files, is spread across the two conversation shares. Output tokens and subagent calls are excluded. Expiry and cache reuse are separate from context size.";

#[derive(Default)]
struct EstimatedLayers {
    system_estimate: u64,
    system_scale: Option<(u64, u64)>,
    tools: u64,
}

impl EstimatedLayers {
    fn calibrate_system(&mut self, observed: u64, estimate_at_anchor: u64) {
        if estimate_at_anchor == 0 {
            self.system_estimate = observed;
            self.system_scale = None;
        } else {
            self.system_scale = Some((observed, estimate_at_anchor));
        }
    }

    fn displayed_system(&self) -> u64 {
        self.system_scale
            .map_or(self.system_estimate, |(target, source)| {
                scale(self.system_estimate, target, source)
            })
    }
}

pub(super) fn build_points(
    turn_count: usize,
    deltas: &[TurnDelta],
    anchors: &[Anchor],
    total_overhead: u64,
) -> Vec<ContextWindowPoint> {
    if anchors.iter().any(|anchor| anchor.total.is_some()) {
        return build_total_points(anchors, total_overhead);
    }
    if turn_count == 0 {
        return Vec::new();
    }

    let mut points = Vec::new();
    let mut interval_start = 1usize;
    let mut base_conversation = 0u64;
    let mut layers = EstimatedLayers::default();

    for anchor in anchors {
        if anchor.turn < interval_start {
            push_observed_anchor(&mut points, anchor);
            layers.calibrate_system(anchor.system, layers.system_estimate);
            layers.tools = anchor.tools;
            base_conversation = anchor.conversation;
            continue;
        }
        let estimate_at_anchor = deltas[interval_start..=anchor.turn]
            .iter()
            .filter_map(|delta| delta.system_tokens)
            .next_back()
            .unwrap_or(layers.system_estimate);
        layers.calibrate_system(anchor.system, estimate_at_anchor);
        layers.tools = anchor.tools;
        append_estimated_interval(
            &mut points,
            deltas,
            interval_start,
            anchor.turn,
            base_conversation,
            anchor,
            &mut layers,
        );
        push_observed_anchor(&mut points, anchor);

        layers.tools = anchor.tools;
        base_conversation = anchor.conversation;
        interval_start = anchor.turn.saturating_add(1);
    }

    if interval_start <= turn_count {
        let fallback = Anchor {
            total: None,
            turn: turn_count,
            timestamp: deltas
                .get(turn_count)
                .and_then(|delta| delta.timestamp.clone()),
            system: layers.displayed_system(),
            tools: layers.tools,
            conversation: base_conversation
                + deltas[interval_start..=turn_count]
                    .iter()
                    .map(|delta| delta.message_tokens + delta.tool_tokens)
                    .sum::<u64>(),
            phase: ContextPointPhase::Turn,
            source: ContextPointSource::Estimated,
        };
        append_estimated_interval(
            &mut points,
            deltas,
            interval_start,
            turn_count,
            base_conversation,
            &fallback,
            &mut layers,
        );
    }

    points
}

/// Points for sources that record each request's inclusive input. The total
/// is observed; its layers are inferred. `overhead` is the first request's
/// input beyond the conversation it sent: the system prompt, tool definitions
/// and persistent instructions, held for the session. It is measured once, at
/// the start: later residuals also carry text the transcript does not record
/// (reminders, re-attached files) and tokenizer drift. The rest of each total
/// is conversation, split by the estimated message and tool shares of what
/// the request sent.
fn build_total_points(anchors: &[Anchor], overhead: u64) -> Vec<ContextWindowPoint> {
    anchors
        .iter()
        .filter_map(|anchor| {
            let total = anchor.total.as_ref()?;
            let system = overhead.min(total.tokens);
            let conversation = total.tokens - system;
            let tool_io = scale(
                total.sent.tool_io,
                conversation,
                total.sent.messages + total.sent.tool_io,
            );
            let mut point = make_point(
                anchor.turn,
                anchor.phase,
                anchor.timestamp.clone(),
                system,
                0,
                conversation,
                ContextPointSource::Observed,
            );
            point.total_only = Some(true);
            point.message_tokens = Some(conversation - tool_io);
            point.tool_io_tokens = Some(tool_io);
            point.cache_read_tokens = total.cache_read;
            point.cache_write_tokens = total.cache_write;
            Some(point)
        })
        .collect()
}

fn append_estimated_interval(
    points: &mut Vec<ContextWindowPoint>,
    deltas: &[TurnDelta],
    start: usize,
    end: usize,
    base_conversation: u64,
    target: &Anchor,
    layers: &mut EstimatedLayers,
) {
    if start > end || end >= deltas.len() {
        return;
    }
    let raw_total = deltas[start..=end]
        .iter()
        .map(|delta| delta.message_tokens + delta.tool_tokens)
        .sum::<u64>();
    let target_growth = target.conversation.saturating_sub(base_conversation);
    let mut raw_conversation = 0u64;

    for (turn, delta) in deltas.iter().enumerate().take(end + 1).skip(start) {
        if let Some(snapshot) = delta.system_tokens {
            layers.system_estimate = snapshot;
        }
        raw_conversation += delta.message_tokens + delta.tool_tokens;
        let scaled_conversation = scale(raw_conversation, target_growth, raw_total);
        points.push(make_point(
            turn,
            ContextPointPhase::Turn,
            delta.timestamp.clone(),
            layers.displayed_system(),
            layers.tools,
            base_conversation + scaled_conversation,
            ContextPointSource::Estimated,
        ));
    }
}

fn push_observed_anchor(points: &mut Vec<ContextWindowPoint>, anchor: &Anchor) {
    points.retain(|point| !(point.turn == anchor.turn && point.phase == ContextPointPhase::Turn));
    points.push(make_point(
        anchor.turn,
        anchor.phase,
        anchor.timestamp.clone(),
        anchor.system,
        anchor.tools,
        anchor.conversation,
        anchor.source,
    ));
}

pub(super) fn finish_compaction(
    draft: CompactionDraft,
    points: &[ContextWindowPoint],
) -> ContextCompaction {
    let after_point = points.iter().find(|point| {
        point.turn == draft.complete_turn && point.phase == ContextPointPhase::PostCompaction
    });
    let after_tokens = after_point.map(|point| point.total_tokens);
    let after_source = after_point.map_or(ContextPointSource::Estimated, |point| point.source);
    ContextCompaction {
        start_turn: draft.start_turn,
        complete_turn: draft.complete_turn,
        timestamp: draft.timestamp,
        success: draft.success,
        checkpoint_number: draft.checkpoint_number,
        before_tokens: draft.before_tokens,
        after_tokens,
        tokens_removed: draft
            .before_tokens
            .zip(after_tokens)
            .map(|(before, after)| before.saturating_sub(after)),
        after_source,
        summary_tokens: draft.summary_tokens,
        compaction_model: draft.compaction_model,
        duration_ms: draft.duration_ms,
        request_input_tokens: draft.request_input_tokens,
        request_output_tokens: draft.request_output_tokens,
        cache_read_tokens: draft.cache_read_tokens,
        cache_write_tokens: draft.cache_write_tokens,
    }
}

pub(super) fn anchor_from_compaction_start(
    turn: usize,
    timestamp: Option<String>,
    data: &CompactionStartData,
) -> Option<Anchor> {
    Some(Anchor {
        total: None,
        turn,
        timestamp,
        system: data.system_tokens?,
        tools: data.tool_definitions_tokens?,
        conversation: data.conversation_tokens?,
        phase: ContextPointPhase::PreCompaction,
        source: ContextPointSource::Observed,
    })
}

pub(super) fn anchor_from_shutdown(
    turn: usize,
    timestamp: Option<String>,
    data: &ShutdownData,
) -> Option<Anchor> {
    Some(Anchor {
        total: None,
        turn,
        timestamp,
        system: data.system_tokens?,
        tools: data.tool_definitions_tokens?,
        conversation: data.conversation_tokens?,
        phase: ContextPointPhase::Shutdown,
        source: ContextPointSource::Observed,
    })
}

pub(super) fn compaction_from_complete(
    start_turn: usize,
    complete_turn: usize,
    timestamp: Option<String>,
    data: &CompactionCompleteData,
) -> CompactionDraft {
    let summary_tokens = data
        .compaction_tokens_used
        .as_ref()
        .and_then(|usage| usage.output_tokens.or(usage.output))
        .or_else(|| data.summary_content.as_deref().map(estimate_tokens));
    let explicit_after = match (
        data.system_tokens,
        data.conversation_tokens,
        data.tool_definitions_tokens,
    ) {
        (Some(system), Some(conversation), Some(tools)) => Some((system, conversation, tools)),
        _ => None,
    };
    let usage = data.compaction_tokens_used.as_ref();
    CompactionDraft {
        start_turn,
        complete_turn,
        timestamp,
        success: data.success.unwrap_or(false),
        checkpoint_number: data.checkpoint_number,
        before_tokens: data.pre_compaction_tokens,
        summary_tokens,
        explicit_after,
        compaction_model: usage.and_then(|item| item.model.clone()),
        duration_ms: usage.and_then(|item| item.duration),
        request_input_tokens: usage.and_then(|item| item.input_tokens.or(item.input)),
        request_output_tokens: usage.and_then(|item| item.output_tokens.or(item.output)),
        cache_read_tokens: usage.and_then(|item| item.cache_read_tokens.or(item.cached_input)),
        cache_write_tokens: usage.and_then(|item| item.cache_write_tokens),
    }
}

fn make_point(
    turn: usize,
    phase: ContextPointPhase,
    timestamp: Option<String>,
    system_tokens: u64,
    tool_definition_tokens: u64,
    conversation_tokens: u64,
    source: ContextPointSource,
) -> ContextWindowPoint {
    ContextWindowPoint {
        turn,
        phase,
        timestamp,
        system_tokens,
        tool_definition_tokens,
        conversation_tokens,
        context_change_tokens: None,
        total_tokens: system_tokens + tool_definition_tokens + conversation_tokens,
        total_only: None,
        message_tokens: None,
        tool_io_tokens: None,
        cache_read_tokens: None,
        cache_write_tokens: None,
        source,
    }
}

pub(super) fn signed_token_change(current: u64, previous: u64) -> i64 {
    let change = i128::from(current) - i128::from(previous);
    change.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
}

fn scale(value: u64, target: u64, source: u64) -> u64 {
    if source == 0 {
        0
    } else {
        ((value as u128 * target as u128) / source as u128) as u64
    }
}

pub(super) fn phase_order(phase: ContextPointPhase) -> u8 {
    match phase {
        ContextPointPhase::Turn => 0,
        ContextPointPhase::PreCompaction => 1,
        ContextPointPhase::PostCompaction => 2,
        ContextPointPhase::Shutdown => 3,
    }
}
