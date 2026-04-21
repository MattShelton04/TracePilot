//! Import, preview, and discover skills from GitHub repositories via the `gh` CLI.

use super::atomic::atomic_dir_install;
use crate::github::TreeEntry;
use crate::skills::error::SkillsError;
use crate::skills::parser::parse_skill_md;
use crate::skills::types::{GitHubSkillPreview, SkillImportResult};
use std::path::Path;

/// Well-known skill directory locations to search in priority order.
const WELL_KNOWN_SKILL_PATHS: &[&str] = &[
    ".",               // Root SKILL.md
    ".github/skills",  // GitHub convention
    ".copilot/skills", // Copilot convention
    ".claude/skills",  // Claude convention
];

/// Resolves the skill directory path within a GitHub repository.
///
/// Searches for SKILL.md using a two-phase strategy:
///
/// **Phase 1: Tree Listing** (if `gh_list_tree` succeeds)
/// 1. Root SKILL.md (if present)
/// 2. SKILL.md in well-known directories (`.github/skills/`, `.copilot/skills/`, `.claude/skills/`)
/// 3. Any SKILL.md found (as fallback)
///
/// **Phase 2: Direct Probes** (if tree listing fails or finds nothing)
/// - Individually checks each well-known path via `gh_get_file`
/// - Handles cases where tree API is slow, rate-limited, or repo is small
///
/// # Parameters
/// - `owner`, `repo`: Repository coordinates
/// - `ref_`: Git reference (branch, tag, or SHA)
///
/// # Returns
/// The discovered base path (e.g., `"."`, `".github/skills/my-skill"`).
///
/// # Errors
/// Returns `SkillsError::Import` if no SKILL.md is found after exhausting all search strategies.
fn resolve_skill_path_in_repo(owner: &str, repo: &str, ref_: &str) -> Result<String, SkillsError> {
    // Try to list the repo tree to find SKILL.md files
    if let Ok(entries) = crate::github::gh_list_tree(owner, repo, ref_) {
        let skill_dirs: Vec<String> = entries
            .iter()
            .filter(|e| e.entry_type == "blob" && e.path.ends_with("/SKILL.md"))
            .map(|e| {
                let p = e.path.trim_end_matches("/SKILL.md");
                p.to_string()
            })
            .collect();

        // Check root SKILL.md
        let has_root = entries
            .iter()
            .any(|e| e.entry_type == "blob" && e.path == "SKILL.md");

        if has_root {
            return Ok(".".to_string());
        }

        // Try well-known prefixes first
        for prefix in &WELL_KNOWN_SKILL_PATHS[1..] {
            for dir in &skill_dirs {
                if dir.starts_with(prefix) {
                    return Ok(dir.clone());
                }
            }
        }

        // Try any SKILL.md found
        if let Some(first_dir) = skill_dirs.first() {
            return Ok(first_dir.clone());
        }
    }

    // Fallback: try each well-known path directly via file probes
    for path in WELL_KNOWN_SKILL_PATHS {
        // Test if path exists by attempting to fetch SKILL.md
        let skill_md_path = if *path == "." {
            "SKILL.md".to_string()
        } else {
            format!("{}/SKILL.md", path.trim_end_matches('/'))
        };

        if crate::github::gh_get_file(owner, repo, &skill_md_path, ref_).is_ok() {
            return Ok(path.to_string());
        }
    }

    Err(SkillsError::Import(format!(
        "No SKILL.md found in {owner}/{repo}. Searched root, well-known directories (.github/skills/, .copilot/skills/, .claude/skills/), and attempted direct file probes."
    )))
}

/// Import a skill from a GitHub repository.
///
/// Uses `gh` CLI to fetch SKILL.md and any assets from the repo.
/// When no explicit skill_path is given, searches well-known locations.
pub fn import_from_github(
    owner: &str,
    repo: &str,
    skill_path: Option<&str>,
    git_ref: Option<&str>,
    dest_parent: &Path,
) -> Result<SkillImportResult, SkillsError> {
    crate::github::gh_check_auth().map_err(|e| SkillsError::GitHub(e.to_string()))?;

    let ref_ = git_ref.unwrap_or("HEAD");

    let base_path = match skill_path {
        Some(path) => path.to_string(),
        None => resolve_skill_path_in_repo(owner, repo, ref_)?,
    };

    import_from_github_path(owner, repo, &base_path, ref_, dest_parent)
}

/// Import a skill from a specific path within a GitHub repository.
/// Uses atomic staging to prevent partial state on failure.
pub(crate) fn import_from_github_path(
    owner: &str,
    repo: &str,
    base_path: &str,
    ref_: &str,
    dest_parent: &Path,
) -> Result<SkillImportResult, SkillsError> {
    crate::github::gh_check_auth().map_err(|e| SkillsError::GitHub(e.to_string()))?;

    let skill_md_path = if base_path == "." {
        "SKILL.md".to_string()
    } else {
        format!("{}/SKILL.md", base_path.trim_end_matches('/'))
    };

    // Fetch the SKILL.md
    let content = crate::github::gh_get_file(owner, repo, &skill_md_path, ref_)
        .map_err(|e| SkillsError::github_ctx("Failed to fetch SKILL.md", e))?;

    let (fm, _) = parse_skill_md(&content)?;

    let (final_dir, (files_copied, warnings)) =
        atomic_dir_install(dest_parent, &fm.name, |staging| {
            std::fs::write(staging.join("SKILL.md"), &content)?;
            let mut files_copied = 1;
            let mut warnings = Vec::new();

            // Fetch all additional files in the skill directory recursively so
            // references/, scripts/, templates/, etc. are preserved during import.
            match crate::github::gh_list_tree(owner, repo, ref_) {
                Ok(entries) => {
                    let prefix = skill_path_prefix(base_path);
                    let asset_paths: Vec<String> = collect_skill_blob_paths(&entries, base_path)
                        .into_iter()
                        .filter(|path| path != &skill_md_path)
                        .collect();
                    let path_refs: Vec<&str> = asset_paths.iter().map(String::as_str).collect();
                    let contents = crate::github::gh_get_files_batch_with_binary(
                        owner, repo, &path_refs, ref_,
                    )
                    .map_err(|e| {
                        SkillsError::GitHub(format!("Failed to fetch skill files: {e}"))
                    })?;

                    for repo_path in asset_paths {
                        let relative = if prefix.is_empty() {
                            repo_path.as_str()
                        } else {
                            &repo_path[prefix.len()..]
                        };
                        // Guard against path traversal from crafted tree entries.
                        // Use component analysis to correctly detect ParentDir
                        // segments without false positives on names like "..foo".
                        let has_traversal = Path::new(relative)
                            .components()
                            .any(|c| matches!(c, std::path::Component::ParentDir));
                        if has_traversal || Path::new(relative).is_absolute() {
                            warnings.push(format!("Skipped '{}': unsafe path component", relative));
                            continue;
                        }
                        match contents.get(&repo_path).and_then(|file| {
                            file.bytes
                                .as_ref()
                                .cloned()
                                .or_else(|| file.text.as_ref().map(|text| text.as_bytes().to_vec()))
                        }) {
                            Some(file_content) => {
                                let dest_path = staging.join(relative);
                                if let Some(parent) = dest_path.parent() {
                                    std::fs::create_dir_all(parent)?;
                                }
                                std::fs::write(dest_path, file_content)?;
                                files_copied += 1;
                            }
                            None => warnings.push(format!(
                                "Failed to fetch {}: file was inaccessible or empty",
                                relative
                            )),
                        }
                    }
                }
                Err(e) => {
                    warnings.push(format!(
                        "Could not list repo tree: {e}. Only SKILL.md was imported."
                    ));
                }
            }

            Ok((files_copied, warnings))
        })?;

    Ok(SkillImportResult {
        skill_name: fm.name,
        destination: final_dir.to_string_lossy().to_string(),
        warnings,
        files_copied,
    })
}

fn skill_path_prefix(base_path: &str) -> String {
    if base_path == "." {
        String::new()
    } else {
        format!("{}/", base_path.trim_end_matches('/'))
    }
}

pub(super) fn collect_skill_blob_paths(entries: &[TreeEntry], base_path: &str) -> Vec<String> {
    let prefix = skill_path_prefix(base_path);
    let mut paths: Vec<String> = entries
        .iter()
        .filter(|entry| entry.entry_type == "blob")
        .filter(|entry| prefix.is_empty() || entry.path.starts_with(&prefix))
        .map(|entry| entry.path.clone())
        .collect();
    paths.sort();
    paths
}

/// Preview a GitHub skill import without actually importing.
/// When no explicit skill_path is given, searches well-known locations.
pub fn preview_github_import(
    owner: &str,
    repo: &str,
    skill_path: Option<&str>,
    git_ref: Option<&str>,
) -> Result<(String, String, Vec<String>), SkillsError> {
    let ref_ = git_ref.unwrap_or("HEAD");

    let base_path = match skill_path {
        Some(path) => path.to_string(),
        None => resolve_skill_path_in_repo(owner, repo, ref_)?,
    };

    preview_github_import_path(owner, repo, &base_path, ref_)
}

/// Preview a GitHub skill import from a specific path.
fn preview_github_import_path(
    owner: &str,
    repo: &str,
    base_path: &str,
    ref_: &str,
) -> Result<(String, String, Vec<String>), SkillsError> {
    let skill_md_path = if base_path == "." {
        "SKILL.md".to_string()
    } else {
        format!("{}/SKILL.md", base_path.trim_end_matches('/'))
    };

    let content = crate::github::gh_get_file(owner, repo, &skill_md_path, ref_)
        .map_err(|e| SkillsError::github_ctx("Failed to fetch SKILL.md", e))?;

    let (fm, _) = parse_skill_md(&content)?;

    crate::github::gh_check_auth().map_err(|e| SkillsError::GitHub(e.to_string()))?;

    // List files that would be imported
    let mut files = vec!["SKILL.md".to_string()];
    if let Ok(entries) = crate::github::gh_list_tree(owner, repo, ref_) {
        let prefix = skill_path_prefix(base_path);
        for repo_path in collect_skill_blob_paths(&entries, base_path) {
            if repo_path == skill_md_path {
                continue;
            }
            if prefix.is_empty() {
                files.push(repo_path);
            } else {
                files.push(repo_path[prefix.len()..].to_string());
            }
        }
    }

    Ok((fm.name, content, files))
}

/// Discover all skills available in a GitHub repository.
/// Returns a list of preview entries for each skill found.
pub fn discover_github_skills(
    owner: &str,
    repo: &str,
    base_path: Option<&str>,
    git_ref: Option<&str>,
) -> Result<Vec<GitHubSkillPreview>, SkillsError> {
    // Fail fast with a clear message if gh is not installed or authenticated.
    crate::github::gh_check_auth().map_err(|e| SkillsError::GitHub(e.to_string()))?;

    let ref_ = git_ref.unwrap_or("HEAD");

    let entries = crate::github::gh_list_tree(owner, repo, ref_)
        .map_err(|e| SkillsError::github_ctx("Failed to list repository", e))?;

    // Find all SKILL.md files in the repo
    let skill_md_paths: Vec<&str> = entries
        .iter()
        .filter(|e| {
            e.entry_type == "blob" && (e.path == "SKILL.md" || e.path.ends_with("/SKILL.md"))
        })
        .map(|e| e.path.as_str())
        .collect();

    // Filter by base_path if specified
    let filtered: Vec<&str> = if let Some(base) = base_path {
        let normalized = base.trim_end_matches('/');
        let prefix = format!("{}/", normalized);
        let exact = format!("{}/SKILL.md", normalized);
        skill_md_paths
            .into_iter()
            .filter(|p| p.starts_with(&prefix) || *p == exact)
            .collect()
    } else {
        skill_md_paths
    };

    // Cap at 50 to avoid overwhelming the API with sequential fetches.
    const MAX_SKILLS: usize = 50;
    let filtered: Vec<&str> = filtered.into_iter().take(MAX_SKILLS).collect();

    // Batch-fetch all SKILL.md contents in at most ⌈N/25⌉ GraphQL calls
    // instead of N sequential `gh api` REST calls.
    let contents =
        crate::github::gh_get_files_batch(owner, repo, &filtered, ref_).unwrap_or_default();

    let mut previews = Vec::new();

    for skill_md_path in &filtered {
        let skill_dir = if *skill_md_path == "SKILL.md" {
            ".".to_string()
        } else {
            skill_md_path.trim_end_matches("/SKILL.md").to_string()
        };

        if let Some(content) = contents.get(*skill_md_path) {
            match parse_skill_md(content) {
                Ok((fm, _)) => {
                    let file_count = collect_skill_blob_paths(&entries, &skill_dir).len();

                    previews.push(GitHubSkillPreview {
                        path: skill_dir,
                        name: fm.name,
                        description: fm.description,
                        file_count,
                    });
                }
                Err(_) => {
                    // Include skills whose frontmatter can't be parsed with a note.
                    previews.push(GitHubSkillPreview {
                        path: skill_dir,
                        name: skill_md_path.to_string(),
                        description: "(Could not parse frontmatter)".to_string(),
                        file_count: 0,
                    });
                }
            }
        }
        // If the path is missing from the batch result the file was inaccessible — skip it.
    }

    Ok(previews)
}

/// Import a specific skill from a GitHub repository by its path.
pub fn import_github_skill(
    owner: &str,
    repo: &str,
    skill_path: &str,
    git_ref: Option<&str>,
    dest_parent: &Path,
) -> Result<SkillImportResult, SkillsError> {
    import_from_github_path(
        owner,
        repo,
        skill_path,
        git_ref.unwrap_or("HEAD"),
        dest_parent,
    )
}
