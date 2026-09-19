use super::{EXPLORE_YAML, REVIEWER_MD};
use crate::agents::parse::{file_stem, parse_definition};
use crate::agents::types::AgentFormat;

#[test]
fn markdown_frontmatter_reads_every_supported_key() {
    let parsed = parse_definition(REVIEWER_MD, AgentFormat::Markdown, "reviewer.agent.md");
    let fields = &parsed.fields;
    assert_eq!(fields.name.as_deref(), Some("reviewer"));
    assert_eq!(fields.models, vec!["claude-opus-5", "gpt-5.6-luna"]);
    assert_eq!(fields.model_policy.as_deref(), Some("required"));
    assert_eq!(fields.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(fields.tools, Some(vec!["view".into(), "grep".into()]));
    assert_eq!(fields.include_custom_instructions, Some(true));
    assert_eq!(parsed.body, "Review the diff.");
    assert!(parsed.mcp_servers.is_some());
    assert_eq!(parsed.other_fields.len(), 1);
    assert_eq!(parsed.other_fields[0].key, "target");
    assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
}

#[test]
fn builtin_yaml_reads_camel_case_keys_and_prompt() {
    let parsed = parse_definition(EXPLORE_YAML, AgentFormat::Yaml, "explore.agent.yaml");
    let fields = &parsed.fields;
    assert_eq!(fields.display_name.as_deref(), Some("Explore Agent"));
    assert_eq!(fields.models, vec!["claude-haiku-4.5"]);
    assert_eq!(
        fields.tools.as_ref().unwrap(),
        &vec![
            "grep".to_string(),
            "github-mcp-server/get_commit".to_string()
        ]
    );
    assert!(parsed.body.starts_with("You are an exploration agent."));
    assert_eq!(parsed.other_fields[0].key, "promptParts");
}

#[test]
fn problems_become_diagnostics_not_errors() {
    let unclosed = parse_definition("---\nname: x\n", AgentFormat::Markdown, "x.md");
    assert!(unclosed.malformed);
    assert_eq!(unclosed.diagnostics[0].severity, "error");

    let invalid = parse_definition("---\nname: [x\n---\nbody", AgentFormat::Markdown, "x.md");
    assert!(invalid.malformed);

    let plain = parse_definition("Just a prompt", AgentFormat::Markdown, "x.md");
    assert!(!plain.malformed);
    assert_eq!(plain.body, "Just a prompt");
    assert_eq!(plain.diagnostics[0].severity, "warning");

    let wrong = parse_definition(
        "---\ndescription: d\nmodel: {a: 1}\nuser-invocable: maybe\n---\n",
        AgentFormat::Markdown,
        "x.md",
    );
    assert!(!wrong.malformed);
    assert_eq!(wrong.diagnostics.len(), 2);
    assert!(wrong.fields.models.is_empty());
}

#[test]
fn comma_separated_tools_and_string_booleans_are_accepted() {
    let parsed = parse_definition(
        "---\ndescription: d\ntools: view, grep\ninfer: \"false\"\n---\n",
        AgentFormat::Markdown,
        "x.md",
    );
    assert_eq!(
        parsed.fields.tools,
        Some(vec!["view".into(), "grep".into()])
    );
    assert_eq!(parsed.fields.infer, Some(false));
}

#[test]
fn file_stems_drop_agent_suffixes() {
    assert_eq!(
        file_stem(std::path::Path::new("a/reviewer.agent.md")),
        "reviewer"
    );
    assert_eq!(file_stem(std::path::Path::new("a/helper.md")), "helper");
    assert_eq!(
        file_stem(std::path::Path::new("a/explore.agent.yaml")),
        "explore"
    );
}
