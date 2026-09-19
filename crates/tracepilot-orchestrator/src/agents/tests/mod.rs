mod discovery;
mod parse;
mod settings;
mod write;

use std::fs;
use std::path::{Path, PathBuf};

use super::AgentRoots;

pub(super) const EXPLORE_YAML: &str = "name: explore
displayName: Explore Agent
description: >
  Fast codebase exploration.
  Safe to call in parallel.
model: claude-haiku-4.5
tools:
  - grep
  # GitHub MCP server tools (read-only)
  - github-mcp-server/get_commit
promptParts:
  includeAISafety: true
prompt: |
  You are an exploration agent.

  Stop searching as soon as you can answer.
";

pub(super) const REVIEWER_MD: &str = "---
# Team reviewer
name: reviewer
description: Reviews changes for correctness and missing tests.
model:
  - claude-opus-5
  - gpt-5.6-luna
model-policy: required
reasoning-effort: high
tools: [view, grep]
include-custom-instructions: true
target: github-copilot
mcp-servers:
  docs:
    command: node
---

Review the diff.
";

/// A throwaway Copilot home with an installed CLI version and a repo.
pub(super) struct Fixture {
    pub _dir: tempfile::TempDir,
    pub home: PathBuf,
    pub repo: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join(".copilot");
        let repo = dir.path().join("repo");
        let version_dir = tracepilot_core::paths::CopilotPaths::from_home(&home)
            .pkg_target_dir()
            .join("1.0.79");
        fs::create_dir_all(version_dir.join("definitions")).unwrap();
        fs::write(version_dir.join(".extraction-complete"), "").unwrap();
        fs::write(
            version_dir.join("definitions/explore.agent.yaml"),
            EXPLORE_YAML,
        )
        .unwrap();
        fs::create_dir_all(&repo).unwrap();
        Self {
            _dir: dir,
            home,
            repo,
        }
    }

    pub fn roots(&self) -> AgentRoots {
        AgentRoots {
            copilot_home: self.home.clone(),
            repo_roots: vec![self.repo.clone()],
        }
    }

    pub fn backups(&self) -> PathBuf {
        self.home.join("tracepilot/backups/agents")
    }

    pub fn write(&self, relative: &Path, content: &str) -> PathBuf {
        let path = self.home.parent().unwrap().join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, content).unwrap();
        path
    }

    pub fn builtin_path(&self) -> PathBuf {
        tracepilot_core::paths::CopilotPaths::from_home(&self.home)
            .pkg_target_dir()
            .join("1.0.79/definitions/explore.agent.yaml")
    }
}
