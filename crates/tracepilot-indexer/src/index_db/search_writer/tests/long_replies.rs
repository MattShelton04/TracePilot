//! A long assistant reply or reasoning block is searchable to its last word
//! (up to a 256 KB safety cap),
//! and still reads as one result with a bounded snippet.

use super::super::extract_search_content;
use super::helpers::*;
use crate::index_db::IndexDb;
use crate::index_db::search_reader::SearchFilters;
use tracepilot_core::SessionId;
use tracepilot_core::models::event_types::{AssistantMessageData, SessionEventType};
use tracepilot_core::parsing::events::TypedEventData;

const SESSION: &str = "00000000-0000-4000-8000-0000000000b2";

/// About `bytes` of prose with multi-byte characters, ending in `tail`.
fn long_text(bytes: usize, tail: &str) -> String {
    let mut text = String::new();
    while text.len() < bytes {
        text.push_str("Le café résumé covers the indexer and its naïve paths. ");
    }
    text.push_str(tail);
    text
}

fn reply_with_reasoning(
    content: &str,
    reasoning: &str,
) -> tracepilot_core::parsing::events::TypedEvent {
    evt(
        SessionEventType::AssistantMessage,
        TypedEventData::AssistantMessage(AssistantMessageData {
            content: Some(content.to_string()),
            reasoning_text: Some(reasoning.to_string()),
            ..Default::default()
        }),
    )
}

/// The per-row safety bound for replies and reasoning (`limits.rs`).
const SAFETY_CAP: usize = 256 * 1024;

#[test]
fn a_reply_past_the_safety_cap_is_cut_at_a_char_boundary() {
    // "é" is two bytes starting at odd offsets, so the cap falls mid-character.
    let huge = format!("a{}", "é".repeat(SAFETY_CAP));
    let events = vec![
        user_message("summarise"),
        assistant_turn_start(),
        reply_with_reasoning(&huge, &huge),
        reasoning(&huge),
        assistant_turn_end(),
    ];

    let rows = extract_search_content(&sid(), &events);
    assert_eq!(rows.len(), 4, "one row per text, never split");
    for row in &rows[1..] {
        assert_eq!(row.content.len(), SAFETY_CAP - 1, "{}", row.content_type);
        assert!(huge.starts_with(&row.content), "{}", row.content_type);
    }
}

#[test]
fn long_replies_and_reasoning_are_extracted_in_full_as_one_row() {
    let reply = long_text(12_000, "zephyrtail");
    let inline_reasoning = long_text(9_000, "quokkatail");
    let reasoning_event = long_text(9_000, "marmottail");
    let events = vec![
        user_message("summarise"),
        assistant_turn_start(),
        reply_with_reasoning(&reply, &inline_reasoning),
        reasoning(&reasoning_event),
        assistant_turn_end(),
    ];

    let rows = extract_search_content(&sid(), &events);
    let kinds: Vec<_> = rows
        .iter()
        .map(|r| (r.content_type, r.event_index))
        .collect();
    assert_eq!(
        kinds,
        vec![
            ("user_message", 0),
            ("assistant_message", 2),
            ("reasoning", 2),
            ("reasoning", 3),
        ],
        "one row per text, never split"
    );
    for (row, text) in rows[1..]
        .iter()
        .zip([&reply, &inline_reasoning, &reasoning_event])
    {
        assert!(
            row.content == *text,
            "{} at event {} indexed {} of {} bytes",
            row.content_type,
            row.event_index,
            row.content.len(),
            text.len()
        );
    }
}

#[test]
fn a_word_past_five_kilobytes_finds_its_reply_once() {
    let reply = long_text(12_000, "zephyrtail");
    let events = vec![
        user_message("summarise"),
        assistant_turn_start(),
        assistant_message(&reply),
        reasoning(&long_text(9_000, "marmottail")),
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&SessionId::from_validated(SESSION), &events);

    let temp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.conn
        .execute(
            "INSERT INTO sessions(id, path, repository) VALUES (?1, 'synthetic', 'repo')",
            [SESSION],
        )
        .unwrap();
    db.bulk_write_search_content(&[(SessionId::from_validated(SESSION), rows)])
        .unwrap();

    let filters = SearchFilters::default();
    for (term, content_type, event_index) in [
        ("zephyrtail", "assistant_message", 2),
        ("marmottail", "reasoning", 3),
    ] {
        let hits = db.query_content(Some(term), &filters).unwrap();
        assert_eq!(hits.len(), 1, "{term}: one result per event");
        assert_eq!(db.query_count(Some(term), &filters).unwrap(), 1);
        let hit = &hits[0];
        assert_eq!(hit.content_type, content_type);
        assert_eq!(hit.event_index, Some(event_index));
        assert_eq!(hit.turn_number, Some(0));
        assert!(
            hit.snippet.contains(&format!("<mark>{term}</mark>")),
            "{term}: highlighted"
        );
        assert!(
            hit.snippet.len() < 1_000,
            "{term}: the snippet stays a window, not the whole reply ({} bytes)",
            hit.snippet.len()
        );
    }

    // Browsing (no query) previews the first 200 characters of each row.
    let browsed = db.query_content(None, &filters).unwrap();
    let preview = |kind: &str| {
        browsed
            .iter()
            .find(|r| r.content_type == kind)
            .map(|r| r.snippet.clone())
            .unwrap()
    };
    assert_eq!(preview("user_message"), "summarise");
    let reply_preview = preview("assistant_message");
    assert_eq!(reply_preview.chars().count(), 201);
    assert!(reply_preview.ends_with('…'));
    assert!(reply.starts_with(reply_preview.trim_end_matches('…')));
}
