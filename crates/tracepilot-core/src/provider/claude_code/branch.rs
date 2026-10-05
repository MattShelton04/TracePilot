//! The visible branch of a transcript (mapping.md §1.3).
//!
//! Event order is always file order. A rewind or edit leaves a *fork*: a
//! record whose children start different interactions, or different calls
//! that are not parallel blocks of one call. Walking `parentUuid` from the
//! last record only decides which child each fork kept; the subtrees of the
//! other children are abandoned. Everything else is visible, including the
//! parallel-tool siblings the walk never visits, so the walk never defines
//! the visible set directly (data-comparison rule 2).

use std::collections::{HashMap, HashSet};

use super::reader::Line;
use super::records::{Rec, block_type};

/// What a child continues, for fork detection.
#[derive(Clone, PartialEq, Eq, Hash)]
enum BranchKey<'a> {
    /// An API call, or a `tool_result` answering one.
    Call(&'a str),
    /// A record that starts a new interaction (human prompt or command).
    Interaction(&'a str),
}

struct Node<'a> {
    parent: Option<&'a str>,
    logical_parent: Option<&'a str>,
    key: Option<BranchKey<'a>>,
}

/// Uuids of records on abandoned branches, and how many walks the cycle
/// guard stopped.
pub(super) fn abandoned_uuids(lines: &[Line]) -> (HashSet<String>, usize) {
    let call_of_tool = tool_use_calls(lines);
    let mut nodes: HashMap<&str, Node<'_>> = HashMap::new();
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut leaf = None;
    for line in lines {
        let rec = Rec(&line.value);
        let Some(uuid) = rec.uuid() else { continue };
        let parent = rec.parent_uuid();
        if let Some(parent) = parent {
            children.entry(parent).or_default().push(uuid);
        }
        if matches!(rec.kind(), "user" | "assistant") {
            leaf = Some(uuid);
        }
        nodes.insert(
            uuid,
            Node {
                parent,
                logical_parent: rec.str("logicalParentUuid"),
                key: branch_key(rec, &call_of_tool),
            },
        );
    }

    let mut cycles = 0;
    let mut on_path = HashSet::new();
    let mut current = leaf;
    while let Some(uuid) = current {
        if !on_path.insert(uuid) {
            cycles += 1;
            break;
        }
        // logicalParentUuid bridges a compaction boundary, whose parentUuid is null.
        current = nodes
            .get(uuid)
            .and_then(|node| node.parent.or(node.logical_parent))
            .filter(|next| nodes.contains_key(next));
    }

    let mut abandoned_roots = Vec::new();
    for kids in children.values() {
        let keyed: Vec<(&str, &BranchKey<'_>)> = kids
            .iter()
            .filter_map(|kid| Some((*kid, nodes.get(kid)?.key.as_ref()?)))
            .collect();
        let distinct: HashSet<_> = keyed.iter().map(|(_, key)| *key).collect();
        if distinct.len() < 2 {
            continue;
        }
        let kept = keyed
            .iter()
            .find(|(kid, _)| on_path.contains(kid))
            .or(keyed.last())
            .map(|(_, key)| *key);
        abandoned_roots.extend(
            keyed
                .iter()
                .filter(|(_, key)| Some(*key) != kept)
                .map(|(kid, _)| *kid),
        );
    }

    let mut abandoned = HashSet::new();
    let mut stack = abandoned_roots;
    while let Some(uuid) = stack.pop() {
        if abandoned.insert(uuid.to_string()) {
            stack.extend(children.get(uuid).into_iter().flatten().copied());
        }
    }
    (abandoned, cycles)
}

fn tool_use_calls(lines: &[Line]) -> HashMap<&str, &str> {
    let mut map = HashMap::new();
    for line in lines {
        let rec = Rec(&line.value);
        let (Some(message_id), Some(blocks)) = (
            rec.message_id(),
            rec.0.pointer("/message/content").and_then(|c| c.as_array()),
        ) else {
            continue;
        };
        for block in blocks.iter().filter(|b| block_type(b) == "tool_use") {
            if let Some(id) = block.get("id").and_then(|v| v.as_str()) {
                map.insert(id, message_id);
            }
        }
    }
    map
}

fn branch_key<'a>(rec: Rec<'a>, call_of_tool: &HashMap<&'a str, &'a str>) -> Option<BranchKey<'a>> {
    match rec.kind() {
        "assistant" => rec.message_id().map(BranchKey::Call),
        "user" if rec.has_tool_results() => {
            let blocks = rec.0.pointer("/message/content")?.as_array()?;
            let tool_id = blocks
                .iter()
                .find(|b| block_type(b) == "tool_result")?
                .get("tool_use_id")?
                .as_str()?;
            call_of_tool.get(tool_id).copied().map(BranchKey::Call)
        }
        "user" if starts_interaction(rec) => rec.uuid().map(BranchKey::Interaction),
        _ => None,
    }
}

/// Human prompts and slash commands. Meta records, notifications, interrupt
/// markers and compaction summaries continue the current interaction.
fn starts_interaction(rec: Rec<'_>) -> bool {
    if rec.flag("isMeta")
        || rec.flag("isCompactSummary")
        || rec.str("interruptedMessageId").is_some()
    {
        return false;
    }
    if matches!(rec.origin_kind(), Some(kind) if kind != "human") {
        return false;
    }
    let text = rec.text().unwrap_or_default();
    !(text.starts_with("[Request interrupted by user")
        || super::notify::contains_notification(&text)
        || text.starts_with("<local-command-stdout>"))
}
