//! Exercise real environment-driven resolution in subprocesses. Environment
//! mutation in a parallel Rust test process is unsafe and makes fixtures depend
//! on the developer's installed CLI, so each scenario owns its process and home.

use std::path::{Path, PathBuf};
use std::process::Command;

use tracepilot_core::paths::{CopilotPaths, cli_install};
use tracepilot_orchestrator::{agents, skills};

#[path = "../src/test_links.rs"]
mod test_links;

const CHILD_ROOT: &str = "TRACEPILOT_INSTALL_TEST_ROOT";

fn in_test_process(name: &str, setup: impl FnOnce(&Path, &mut Command)) -> Option<PathBuf> {
    if let Some(root) = std::env::var_os(CHILD_ROOT) {
        return Some(PathBuf::from(root));
    }
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let mut child = Command::new(std::env::current_exe().unwrap());
    child
        .args(["--exact", name, "--nocapture"])
        .env(CHILD_ROOT, root)
        .env("COPILOT_HOME", root.join(".copilot"))
        .env("PATH", root.join("prefix"));
    for key in [
        "TRACEPILOT_DATA_ROOT",
        "COPILOT_CLI_DIST_DIR",
        "COPILOT_SKILLS_DIRS",
        "COPILOT_PKG_CACHE_HOME",
        "COPILOT_CACHE_HOME",
        "npm_config_prefix",
        "NPM_CONFIG_PREFIX",
        "PREFIX",
        "NVM_BIN",
    ] {
        child.env_remove(key);
    }
    for key in [
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "ProgramFiles",
        "XDG_CACHE_HOME",
    ] {
        child.env(key, root.join("user"));
    }
    setup(root, &mut child);
    let output = child.output().unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    None
}

fn skill(root: &Path, name: &str) {
    std::fs::create_dir_all(root).unwrap();
    std::fs::write(
        root.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: Test skill\n---\nBody\n"),
    )
    .unwrap();
}

fn dist(root: &Path, version: &str) {
    std::fs::create_dir_all(root.join("definitions")).unwrap();
    std::fs::write(
        root.join("definitions/explore.agent.yaml"),
        "name: explore\ndescription: Test agent\nprompt: Explore\n",
    )
    .unwrap();
    std::fs::write(
        root.join("package.json"),
        format!("{{\"version\":\"{version}\"}}"),
    )
    .unwrap();
    std::fs::write(root.join(".extraction-complete"), "").unwrap();
    skill(&root.join("builtin-skills/probe"), "probe");
}

fn default_cache(root: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        root.join("user/Library/Caches/copilot/pkg")
    } else {
        // LOCALAPPDATA on Windows, XDG_CACHE_HOME on Linux.
        root.join("user/copilot/pkg")
    }
}

#[test]
fn personal_roots_keep_global_scope_when_opened() {
    let Some(root) = in_test_process(
        "personal_roots_keep_global_scope_when_opened",
        |root, child| {
            skill(&root.join(".copilot/skills/original"), "original");
            skill(&root.join(".agents/skills/alternative"), "alternative");
            skill(&root.join("extra/custom"), "custom");
            child.env("COPILOT_SKILLS_DIRS", root.join("extra"));
        },
    ) else {
        return;
    };
    let catalog = skills::discovery::discover_user_skills(&root.join(".copilot")).unwrap();
    let personal: Vec<_> = catalog
        .skills
        .iter()
        .filter(|s| s.scope == skills::types::SkillScope::Global)
        .collect();
    assert_eq!(personal.len(), 3);
    for summary in personal {
        let path = Path::new(&summary.directory);
        skills::manager::validate_mutable_skill_dir(path).unwrap();
        assert_eq!(
            skills::manager::get_skill(path).unwrap().scope,
            summary.scope
        );
    }
    let project = root.join("repo/.agents/skills/project");
    skill(&project, "project");
    assert_eq!(
        skills::manager::get_skill(&project).unwrap().scope,
        skills::types::SkillScope::Repository
    );
}

#[test]
fn explicit_override_replaces_catalog_but_preserves_packaged_write_protection() {
    let Some(root) = in_test_process(
        "explicit_override_replaces_catalog_but_preserves_packaged_write_protection",
        |root, child| {
            let cached = root.join(".copilot/pkg/universal/2.0.0");
            dist(&cached, "2.0.0");
            skill(&cached.join("builtin-skills/cached-only"), "cached-only");
            dist(&root.join("override"), "1.0.0");
            dist(&default_cache(root).join("universal/3.0.0"), "3.0.0");
            child.env("COPILOT_CLI_DIST_DIR", root.join("override"));
        },
    ) else {
        return;
    };
    let home = root.join(".copilot");
    let catalog = agents::discover(&agents::AgentRoots::new(home.clone(), vec![]));
    assert_eq!(catalog.cli_version.as_deref(), Some("1.0.0"));
    let found = skills::discovery::discover_user_skills(&home).unwrap();
    assert_eq!(found.skills.len(), 1);
    assert!(Path::new(&found.skills[0].directory).starts_with(root.join("override")));
    for directory in [
        root.join("override/builtin-skills/probe"),
        default_cache(&root).join("universal/3.0.0/builtin-skills/probe"),
        root.join(".copilot/pkg/universal/2.0.0/builtin-skills/probe"),
    ] {
        skills::manager::validate_skill_dir(&directory).unwrap();
        assert!(matches!(
            skills::manager::validate_mutable_skill_dir(&directory),
            Err(skills::SkillsError::ReadOnly(_))
        ));
    }
}

#[test]
fn current_cache_is_discovered_alongside_legacy_packages() {
    let Some(root) = in_test_process(
        "current_cache_is_discovered_alongside_legacy_packages",
        |root, _| {
            dist(&root.join(".copilot/pkg/universal/1.0.0"), "1.0.0");
            dist(&default_cache(root).join("universal/2.0.0"), "2.0.0");
            let incomplete = default_cache(root).join("universal/3.0.0");
            dist(&incomplete, "3.0.0");
            std::fs::remove_file(incomplete.join(".extraction-complete")).unwrap();
        },
    ) else {
        return;
    };
    let home = root.join(".copilot");
    let mut roots = agents::AgentRoots::new(home, vec![]);
    // System npm prefixes are intentionally discoverable even with a fixture
    // home. Only this test's installations participate in version selection.
    roots.dist_roots.retain(|dist| dist.path.starts_with(&root));
    assert_eq!(roots.dist_roots.len(), 3);
    assert_eq!(
        agents::discover(&roots).cli_version.as_deref(),
        Some("2.0.0")
    );
}

#[test]
fn fresh_install_and_explicit_cache_locations_are_discovered() {
    let Some(root) = in_test_process(
        "fresh_install_and_explicit_cache_locations_are_discovered",
        |root, child| {
            dist(&default_cache(root).join("universal/1.0.0"), "1.0.0");
            dist(&root.join("package-cache/pkg/universal/2.0.0"), "2.0.0");
            dist(&root.join("compat-cache/pkg/universal/3.0.0"), "3.0.0");
            child.env("COPILOT_PKG_CACHE_HOME", root.join("package-cache"));
            child.env("COPILOT_CACHE_HOME", root.join("compat-cache"));
        },
    ) else {
        return;
    };
    let roots: Vec<_> = cli_install::dist_roots(&root.join(".copilot"))
        .into_iter()
        .filter(|dist| dist.path.starts_with(&root))
        .collect();
    assert_eq!(roots.len(), 3);
    assert!(
        roots
            .iter()
            .all(|r| r.source == cli_install::DistSource::PackageCache)
    );
    assert!(!root.join(".copilot/pkg").exists());
}

#[test]
fn invalid_override_falls_back_to_legacy_installation() {
    let Some(root) = in_test_process(
        "invalid_override_falls_back_to_legacy_installation",
        |root, child| {
            dist(&root.join(".copilot/pkg/universal/1.0.0"), "1.0.0");
            child.env("COPILOT_CLI_DIST_DIR", root.join("missing"));
        },
    ) else {
        return;
    };
    let paths = CopilotPaths::try_default().unwrap();
    assert_eq!(paths.home(), root.join(".copilot"));
    let mut roots = agents::AgentRoots::new(paths.home().to_owned(), vec![]);
    roots.dist_roots.retain(|dist| dist.path.starts_with(&root));
    assert_eq!(
        agents::discover(&roots).cli_version.as_deref(),
        Some("1.0.0")
    );
}

#[test]
#[cfg(windows)]
fn windows_path_shim_resolves_sibling_node_modules() {
    let Some(root) = in_test_process(
        "windows_path_shim_resolves_sibling_node_modules",
        |root, _| {
            dist(&root.join("prefix/node_modules/@github/copilot"), "1.0.0");
            std::fs::write(root.join("prefix/copilot.cmd"), "@echo off\n").unwrap();
        },
    ) else {
        return;
    };
    let expected = root
        .join("prefix/node_modules/@github/copilot")
        .canonicalize()
        .unwrap();
    let found = cli_install::dist_roots(&root.join(".copilot"));
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].path.canonicalize().unwrap(), expected);
}

#[test]
fn isolation_excludes_external_environment_roots_and_keeps_local_ones() {
    let Some(root) = in_test_process(
        "isolation_excludes_external_environment_roots_and_keeps_local_ones",
        |root, child| {
            skill(&root.join("external/.agents/skills/private"), "private");
            skill(&root.join("isolated/extra/local"), "local");
            dist(&root.join("external-dist"), "9.0.0");
            dist(&default_cache(root).join("universal/8.0.0"), "8.0.0");
            dist(&root.join("isolated/copilot/pkg/universal/1.0.0"), "1.0.0");
            child.env("TRACEPILOT_DATA_ROOT", root.join("isolated"));
            child.env("COPILOT_CLI_DIST_DIR", root.join("external-dist"));
            child.env("COPILOT_PKG_CACHE_HOME", root.join("external-dist"));
            child.env(
                "COPILOT_SKILLS_DIRS",
                std::env::join_paths([
                    root.join("external/.agents/skills"),
                    root.join("isolated/extra"),
                ])
                .unwrap(),
            );
        },
    ) else {
        return;
    };
    let home = CopilotPaths::try_default().unwrap();
    assert_eq!(home.home(), root.join("isolated/copilot"));
    let found = skills::discovery::discover_user_skills(home.home()).unwrap();
    assert_eq!(found.skills.len(), 2);
    assert!(found.skills.iter().all(|s| s.name != "private"));
    assert!(
        skills::manager::validate_mutable_skill_dir(&root.join("external/.agents/skills/private"))
            .is_err()
    );
    skills::manager::validate_mutable_skill_dir(&root.join("isolated/extra/local")).unwrap();
    let roots = home.dist_roots();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].version.as_deref(), Some("1.0.0"));
}

#[test]
fn invalid_isolation_fails_closed() {
    let Some(root) = in_test_process("invalid_isolation_fails_closed", |root, child| {
        dist(&root.join("override"), "1.0.0");
        skill(&root.join("extra/private"), "private");
        child.env("TRACEPILOT_DATA_ROOT", "relative/invalid");
        child.env("COPILOT_CLI_DIST_DIR", root.join("override"));
        child.env("COPILOT_SKILLS_DIRS", root.join("extra"));
    }) else {
        return;
    };
    assert!(cli_install::dist_roots(&root.join(".copilot")).is_empty());
    assert!(skills::discovery::personal_skill_dirs(&root.join(".copilot")).is_empty());
    assert!(skills::manager::validate_mutable_skill_dir(&root.join("extra/private")).is_err());
}

#[test]
fn linked_personal_and_project_skills_keep_scope_and_builtin_protection() {
    let Some(root) = in_test_process(
        "linked_personal_and_project_skills_keep_scope_and_builtin_protection",
        |root, _| {
            skill(&root.join("shared"), "shared");
            dist(&default_cache(root).join("universal/1.0.0"), "1.0.0");
            test_links::directory_link(&root.join("shared"), &root.join(".agents/skills/personal"));
            test_links::directory_link(
                &root.join("shared"),
                &root.join("repo/.github/skills/project"),
            );
            test_links::directory_link(
                &default_cache(root).join("universal/1.0.0/builtin-skills/probe"),
                &root.join("repo/.github/skills/packaged"),
            );
        },
    ) else {
        return;
    };
    for (relative, scope) in [
        (".agents/skills/personal", skills::types::SkillScope::Global),
        (
            "repo/.github/skills/project",
            skills::types::SkillScope::Repository,
        ),
    ] {
        let directory = root.join(relative);
        skills::manager::validate_mutable_skill_dir(&directory).unwrap();
        assert_eq!(skills::manager::get_skill(&directory).unwrap().scope, scope);
    }
    let packaged = root.join("repo/.github/skills/packaged");
    skills::manager::validate_skill_dir(&packaged).unwrap();
    assert!(matches!(
        skills::manager::validate_mutable_skill_dir(&packaged),
        Err(skills::SkillsError::ReadOnly(_))
    ));
}

#[test]
fn isolation_rejects_links_to_external_skills_and_distributions() {
    let Some(root) = in_test_process(
        "isolation_rejects_links_to_external_skills_and_distributions",
        |root, child| {
            skill(&root.join("outside/private"), "private");
            dist(&root.join("outside-dist"), "9.0.0");
            test_links::directory_link(
                &root.join("outside/private"),
                &root.join("isolated/copilot/skills/linked"),
            );
            test_links::directory_link(&root.join("outside"), &root.join("isolated/extra"));
            test_links::directory_link(&root.join("outside-dist"), &root.join("isolated/dist"));
            child.env("TRACEPILOT_DATA_ROOT", root.join("isolated"));
            child.env("COPILOT_SKILLS_DIRS", root.join("isolated/extra"));
            child.env("COPILOT_CLI_DIST_DIR", root.join("isolated/dist"));
        },
    ) else {
        return;
    };
    let home = CopilotPaths::try_default().unwrap();
    assert!(home.dist_roots().is_empty());
    assert!(
        skills::discovery::discover_user_skills(home.home())
            .unwrap()
            .skills
            .is_empty()
    );
    assert!(
        skills::manager::validate_mutable_skill_dir(&root.join("isolated/copilot/skills/linked"))
            .is_err()
    );
}
