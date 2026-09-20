use std::path::Path;

use super::{EXPLORE_YAML, Fixture, REVIEWER_MD};
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
        dist_roots: Vec::new(),
    });
    assert!(catalog.definitions.is_empty());
    assert!(catalog.cli_version.is_none());
    assert_eq!(
        catalog
            .diagnostics
            .iter()
            .map(|d| d.severity.as_str())
            .collect::<Vec<_>>(),
        vec!["warning"],
        "a missing CLI is reported as a warning, not a failure"
    );
}

#[test]
fn a_cli_installed_outside_the_copilot_home_still_supplies_builtin_agents() {
    let fixture = Fixture::new();
    // An npm global install: no extracted package under the Copilot home.
    let package = fixture.repo.join("node_modules/@github/copilot");
    std::fs::create_dir_all(package.join("definitions")).unwrap();
    std::fs::write(package.join("definitions/explore.agent.yaml"), EXPLORE_YAML).unwrap();
    fixture.write(
        Path::new(".copilot/agents/mine.agent.md"),
        "---\ndescription: Personal\n---\nHi",
    );

    let catalog = discover(&crate::agents::AgentRoots {
        copilot_home: fixture.home.clone(),
        repo_roots: vec![],
        dist_roots: vec![tracepilot_core::paths::cli_install::DistRoot {
            path: package.clone(),
            version: Some("1.0.86".into()),
            source: tracepilot_core::paths::cli_install::DistSource::NodeModules,
        }],
    });

    let explore = catalog
        .definitions
        .iter()
        .find(|d| d.name == "explore")
        .expect("built-in agent from the npm package");
    assert_eq!(explore.scope, AgentScope::Builtin);
    assert_eq!(explore.source_label, "Copilot CLI 1.0.86");
    assert!(catalog.definitions.iter().any(|d| d.name == "mine"));
}

#[test]
fn personal_agents_survive_a_missing_cli_installation() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join(".copilot");
    std::fs::create_dir_all(home.join("agents")).unwrap();
    std::fs::write(
        home.join("agents/solo.agent.md"),
        "---\ndescription: Personal\n---\nHi",
    )
    .unwrap();

    let catalog = discover(&crate::agents::AgentRoots {
        copilot_home: home,
        repo_roots: vec![],
        dist_roots: Vec::new(),
    });

    assert_eq!(catalog.definitions.len(), 1);
    assert_eq!(catalog.definitions[0].scope, AgentScope::Personal);
    assert!(catalog.cli_version.is_none());
    assert!(catalog.diagnostics.iter().all(|d| d.severity == "warning"));
}

#[test]
fn linked_agent_directories_are_discovered_without_following_cycles() {
    let fixture = Fixture::new();
    let shared = fixture.repo.join("shared");
    std::fs::create_dir_all(&shared).unwrap();
    std::fs::write(shared.join("reviewer.md"), REVIEWER_MD).unwrap();
    crate::test_links::directory_link(&shared, &shared.join("cycle"));
    let installed = fixture.repo.join(".github/agents/team");
    crate::test_links::directory_link(&shared, &installed);
    let catalog = discover(&fixture.roots());
    let entries: Vec<_> = catalog
        .definitions
        .iter()
        .filter(|d| d.name == "reviewer")
        .collect();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].scope, AgentScope::Project);
    assert_eq!(Path::new(&entries[0].path), installed.join("reviewer.md"));
}
