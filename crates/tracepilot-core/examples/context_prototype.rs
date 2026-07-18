use std::path::PathBuf;
use tracepilot_core::context_window::build_context_timeline;
use tracepilot_core::parsing::events::parse_typed_events;

fn main() {
    let path = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("usage: context_prototype <events.jsonl>"),
    );
    let parsed = parse_typed_events(&path).expect("parse session");
    let timeline = build_context_timeline(&parsed.events);
    println!(
        "{}",
        serde_json::to_string_pretty(&timeline).expect("serialize timeline")
    );
}
