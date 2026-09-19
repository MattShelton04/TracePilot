use std::fs;
use std::path::Path;

use super::{Fixture, REVIEWER_MD};
use crate::agents::parse::parse_definition;
use crate::agents::types::{AgentCreateScope, AgentFormat};
use crate::agents::write::{
    BuiltinWrites, apply_changes, create, delete, render_update, save_fields, save_raw,
};

#[test]
fn changing_one_field_keeps_comments_unknown_keys_and_other_values() {
    let current = parse_definition(REVIEWER_MD, AgentFormat::Markdown, "r.md");
    let mut fields = current.fields.clone();
    fields.reasoning_effort = Some("medium".into());
    let out = apply_changes(
        REVIEWER_MD,
        AgentFormat::Markdown,
        &current,
        &fields,
        &current.body,
    );
    assert_eq!(
        out,
        REVIEWER_MD.replace("reasoning-effort: high", "reasoning-effort: medium"),
        "only the changed line differs"
    );
}

#[test]
fn model_lists_tools_and_body_round_trip() {
    let current = parse_definition(REVIEWER_MD, AgentFormat::Markdown, "r.md");
    let mut fields = current.fields.clone();
    fields.models = vec!["claude-opus-5".into()];
    fields.tools = None;
    fields.user_invocable = Some(false);
    let out = apply_changes(
        REVIEWER_MD,
        AgentFormat::Markdown,
        &current,
        &fields,
        "New prompt",
    );
    let reparsed = parse_definition(&out, AgentFormat::Markdown, "r.md");
    assert_eq!(reparsed.fields.models, vec!["claude-opus-5"]);
    assert_eq!(reparsed.fields.tools, None);
    assert_eq!(reparsed.fields.user_invocable, Some(false));
    assert_eq!(reparsed.body, "New prompt");
    assert!(out.contains("# Team reviewer"));
    assert!(out.contains("mcp-servers:\n  docs:\n    command: node"));
}

#[test]
fn files_without_frontmatter_gain_one() {
    let current = parse_definition("Only a prompt\n", AgentFormat::Markdown, "p.md");
    let mut fields = current.fields.clone();
    fields.description = Some("Helps".into());
    let out = apply_changes(
        "Only a prompt\n",
        AgentFormat::Markdown,
        &current,
        &fields,
        &current.body,
    );
    assert_eq!(out, "---\ndescription: Helps\n---\n\nOnly a prompt\n");
}

#[test]
fn builtin_model_edit_keeps_tool_comments() {
    let fixture = Fixture::new();
    let path = fixture.builtin_path();
    let content = fs::read_to_string(&path).unwrap();
    let current = parse_definition(&content, AgentFormat::Yaml, "e.yaml");
    let mut fields = current.fields.clone();
    fields.models = vec!["gpt-5.4-mini".into()];
    let out = render_update(&path, &fields, &current.body).unwrap();
    assert_eq!(
        out,
        content.replace("model: claude-haiku-4.5", "model: gpt-5.4-mini")
    );
}

#[test]
fn builtins_need_advanced_mode_and_plugins_are_never_writable() {
    let fixture = Fixture::new();
    let roots = fixture.roots();
    let path = fixture.builtin_path();
    let content = fs::read_to_string(&path).unwrap();
    let edited = content.replace("claude-haiku-4.5", "gpt-5.4-mini");
    assert!(
        save_raw(
            &roots,
            &path,
            &edited,
            BuiltinWrites::Denied,
            &fixture.backups()
        )
        .is_err()
    );
    let result = save_raw(
        &roots,
        &path,
        &edited,
        BuiltinWrites::Allowed,
        &fixture.backups(),
    )
    .unwrap();
    assert!(result.backup_path.is_some());
    assert_eq!(fs::read_to_string(&path).unwrap(), edited);

    let plugin = fixture.write(
        Path::new(".copilot/installed-plugins/kit/agents/helper.agent.md"),
        REVIEWER_MD,
    );
    assert!(
        save_raw(
            &roots,
            &plugin,
            REVIEWER_MD,
            BuiltinWrites::Allowed,
            &fixture.backups()
        )
        .is_err()
    );
}

#[test]
fn create_edit_and_delete_a_personal_agent_with_backups() {
    let fixture = Fixture::new();
    let roots = fixture.roots();
    let created = create(
        &roots,
        AgentCreateScope::Personal,
        None,
        "reviewer",
        "Reviews code",
    )
    .unwrap();
    let path = Path::new(&created.path).to_path_buf();
    assert!(path.ends_with("agents/reviewer.agent.md"));
    assert!(create(&roots, AgentCreateScope::Personal, None, "reviewer", "").is_err());
    assert!(create(&roots, AgentCreateScope::Personal, None, "../evil", "").is_err());

    let content = fs::read_to_string(&path).unwrap();
    let current = parse_definition(&content, AgentFormat::Markdown, "r.md");
    assert_eq!(current.fields.description.as_deref(), Some("Reviews code"));
    let mut fields = current.fields.clone();
    fields.models = vec!["claude-opus-5".into(), "gpt-5.6-luna".into()];
    let saved = save_fields(
        &roots,
        &path,
        &fields,
        &current.body,
        BuiltinWrites::Denied,
        &fixture.backups(),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(saved.backup_path.as_ref().unwrap()).unwrap(),
        content,
        "the backup holds the previous version"
    );
    assert!(
        fs::read_to_string(&path)
            .unwrap()
            .contains("  - gpt-5.6-luna")
    );

    // Invalid raw content is refused and the file is untouched.
    let before = fs::read_to_string(&path).unwrap();
    assert!(
        save_raw(
            &roots,
            &path,
            "---\nname: [\n",
            BuiltinWrites::Denied,
            &fixture.backups()
        )
        .is_err()
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), before);

    delete(&roots, &path, &fixture.backups()).unwrap();
    assert!(!path.exists());
}

#[test]
fn project_agents_require_a_registered_repository() {
    let fixture = Fixture::new();
    let roots = fixture.roots();
    let created = create(
        &roots,
        AgentCreateScope::Project,
        Some(&fixture.repo),
        "helper",
        "",
    )
    .unwrap();
    assert!(Path::new(&created.path).ends_with(".github/agents/helper.agent.md"));

    let stranger = fixture.write(
        Path::new("elsewhere/.github/agents/x.agent.md"),
        REVIEWER_MD,
    );
    assert!(
        save_raw(
            &roots,
            &stranger,
            REVIEWER_MD,
            BuiltinWrites::Denied,
            &fixture.backups()
        )
        .is_err()
    );
    let other_repo = fixture.home.parent().unwrap().join("elsewhere");
    assert!(
        create(
            &roots,
            AgentCreateScope::Project,
            Some(&other_repo),
            "x",
            ""
        )
        .is_err()
    );
}
