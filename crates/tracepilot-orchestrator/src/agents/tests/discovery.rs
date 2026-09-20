use std::path::Path;

use super::{Fixture, REVIEWER_MD};
use crate::agents::discover;
use crate::agents::types::{AgentFormat, AgentScope};

#[test]
fn every_source_is_discovered_with_scope_and_labels() {
    let fixture = Fixture::new();
    fixture.write(
        Path::new(".copilot/agents/team/reviewer.agent.md"),
        REVIEWER_MD,
    );
    fixture.write(Path::new(".copilot/agents/README.md"), "# not an agent");
    fixture.write(
        Path::new("repo/.github/agents/helper.agent.md"),
        "---\ndescription: Repo helper\n---\nHelp.",
    );
    fixture.write(
        Path::new("repo/.claude/agents/claude-style.md"),
        "---\nname: claude-style\ndescription: Claude format\n---\nHi",
    );
    fixture.write(
        Path::new(".copilot/installed-plugins/kit/plugin/agents/kit-agent.md"),
        "---\ndescription: From a plugin\n---\nHi",
    );
    fixture.write(
        Path::new(".copilot/installed-plugins/kit/docs/not-an-agent.md"),
        "# docs",
    );

    let catalog = discover(&fixture.roots());
    assert_eq!(catalog.cli_version.as_deref(), Some("1.0.79"));
    let find = |name: &str| {
        catalog
            .definitions
            .iter()
            .find(|d| d.name == name)
            .unwrap_or_else(|| panic!("{name} missing: {:?}", catalog.definitions))
    };

    let explore = find("explore");
    assert_eq!(explore.scope, AgentScope::Builtin);
    assert_eq!(explore.format, AgentFormat::Yaml);
    assert_eq!(explore.source_label, "Copilot CLI 1.0.79");
    assert!(explore.read_only_reason.is_some());

    let reviewer = find("reviewer");
    assert_eq!(reviewer.scope, AgentScope::Personal);
    assert!(reviewer.has_mcp_servers);
    assert!(reviewer.read_only_reason.is_none());

    let helper = find("helper");
    assert_eq!(helper.scope, AgentScope::Project);
    assert_eq!(helper.file_stem, "helper");
    assert_eq!(helper.source_label, "repo");
    assert!(helper.repo_root.is_some());

    assert_eq!(find("claude-style").scope, AgentScope::Project);
    let plugin = find("kit-agent");
    assert_eq!(plugin.scope, AgentScope::Plugin);
    assert_eq!(plugin.source_label, "kit");
    assert!(plugin.read_only_reason.is_some());

    assert_eq!(
        catalog.definitions.len(),
        5,
        "README and plugin docs are skipped"
    );
}

#[test]
fn malformed_definitions_are_listed_with_an_error_diagnostic() {
    let fixture = Fixture::new();
    fixture.write(
        Path::new(".copilot/agents/broken.agent.md"),
        "---\nname: [\n---\n",
    );
    let catalog = discover(&fixture.roots());
    assert!(catalog.definitions.iter().any(|d| d.name == "broken"));
    assert_eq!(catalog.diagnostics.len(), 1);
}

#[test]
fn missing_sources_produce_an_empty_catalog() {
    let dir = tempfile::tempdir().unwrap();
    let catalog = discover(&crate::agents::AgentRoots {
        copilot_home: dir.path().join("none"),
        repo_roots: vec![dir.path().join("missing-repo")],
    });
    assert!(catalog.definitions.is_empty());
    assert!(catalog.cli_version.is_none());
    assert!(catalog.diagnostics.is_empty());
}
