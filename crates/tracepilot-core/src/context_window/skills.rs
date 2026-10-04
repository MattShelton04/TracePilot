//! Skill context folding: count the model-visible skill wrapper once.
//!
//! Older CLIs inject a synthetic `<skill-context>` user message after
//! `skill.invoked`; 1.0.86+ records `skill.context_delivered(_ref)` instead.
//! Either way the wrapper is counted and the bare invocation body is folded.

use crate::parsing::events::{TypedEvent, TypedEventData};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Default)]
pub(super) struct FoldedSkillContexts {
    pub(super) invocation_indexes: HashSet<usize>,
    pub(super) message_indexes: HashSet<usize>,
}

pub(super) fn folded_skill_contexts(events: &[TypedEvent]) -> FoldedSkillContexts {
    let invocations = events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| {
            let (name, content) = match &event.typed_data {
                TypedEventData::SkillInvoked(data) => (&data.name, &data.content),
                TypedEventData::SkillInvokedRef(data) => (&data.name, &data.resolved_content),
                _ => return None,
            };
            Some((
                event.raw.id.as_deref()?,
                (index, name.as_deref(), content.as_deref()),
            ))
        })
        .collect::<HashMap<_, _>>();
    let mut folded = FoldedSkillContexts::default();

    // 1.0.86+ delivers the wrapper as its own event, parented to the
    // invocation; that event is counted and the bare body is not.
    for event in events {
        if matches!(
            event.typed_data,
            TypedEventData::SkillContextDelivered(_) | TypedEventData::SkillContextDeliveredRef(_)
        ) && let Some((invocation_index, ..)) = event
            .raw
            .parent_id
            .as_deref()
            .and_then(|parent_id| invocations.get(parent_id))
        {
            folded.invocation_indexes.insert(*invocation_index);
        }
    }

    for (message_index, event) in events.iter().enumerate() {
        let TypedEventData::UserMessage(data) = &event.typed_data else {
            continue;
        };
        let Some((invocation_index, name, skill_content)) = event
            .raw
            .parent_id
            .as_deref()
            .and_then(|parent_id| invocations.get(parent_id))
        else {
            continue;
        };
        let Some(content) = data.content.as_deref().map(str::trim_start) else {
            continue;
        };
        if !content.starts_with("<skill-context") {
            continue;
        }
        if name.is_some_and(|name| {
            !content.contains(&format!("name=\"{name}\""))
                && !content.contains(&format!("name='{name}'"))
        }) {
            continue;
        }
        if skill_content.is_some_and(|skill_content| {
            !skill_content.trim().is_empty() && !content.contains(skill_content)
        }) {
            continue;
        }
        folded.invocation_indexes.insert(*invocation_index);
        folded.message_indexes.insert(message_index);
    }

    folded
}
