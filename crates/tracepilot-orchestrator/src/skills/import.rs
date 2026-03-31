//! Skill import operations — from local paths, GitHub repos, and files.

use crate::skills::error::SkillsError;
use crate::skills::parser::parse_skill_md;
use crate::skills::types::{GitHubSkillPreview, LocalSkillPreview, RepoSkillsResult, SkillImportResult};
use std::path::Path;

/// Import a skill from a local directory.
///
/// Copies the entire directory contents to the global skills folder.
pub fn import_from_local(source_dir: &Path, dest_parent: &Path) -> Result<SkillImportResult, SkillsError> {
    let skill_md = source_dir.join("SKILL.md");
    if !skill_md.exists() {
        return Err(SkillsError::Import(format!(
            "No SKILL.md found in {}. This directory doesn't appear to be a Copilot skill. Skills must contain a SKILL.md file.",
            source_dir.display()
        )));
    }

    // Parse to get the skill name
    let content = std::fs::read_to_string(&skill_md)?;
    let (fm, _) = parse_skill_md(&content)?;

    let dest_dir = dest_parent.join(&fm.name);
    if dest_dir.exists() {
        return Err(SkillsError::DuplicateSkill(fm.name.clone()));
    }

    let files_copied = copy_dir_contents(source_dir, &dest_dir)?;

    Ok(SkillImportResult {
        skill_name: fm.name,
        destination: dest_dir.to_string_lossy().to_string(),
        warnings: vec![],
        files_copied,
    })
}

/// Import a skill from a SKILL.md file (single file import).
///
/// Creates a new skill directory with just the SKILL.md file.
pub fn import_from_file(file_path: &Path, dest_parent: &Path) -> Result<SkillImportResult, SkillsError> {
    let content = std::fs::read_to_string(file_path)?;
    let (fm, _) = parse_skill_md(&content)?;

    let dest_dir = dest_parent.join(&fm.name);
    if dest_dir.exists() {
        return Err(SkillsError::DuplicateSkill(fm.name.clone()));
    }

    std::fs::create_dir_all(&dest_dir)?;
    std::fs::write(dest_dir.join("SKILL.md"), &content)?;

    Ok(SkillImportResult {
        skill_name: fm.name,
        destination: dest_dir.to_string_lossy().to_string(),
        warnings: vec![],
        files_copied: 1,
    })
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
    let ref_ = git_ref.unwrap_or("HEAD");

    // If explicit path given, use it directly
    if let Some(base_path) = skill_path {
        return import_from_github_path(owner, repo, base_path, ref_, dest_parent);
    }

    // Well-known skill locations to probe
    let well_known_paths = [
        ".",                // Root SKILL.md
        ".github/skills",  // GitHub convention
        ".copilot/skills",  // Copilot convention
        ".claude/skills",   // Claude convention
    ];

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
            return import_from_github_path(owner, repo, ".", ref_, dest_parent);
        }

        // Try well-known prefixes first
        for prefix in &well_known_paths[1..] {
            for dir in &skill_dirs {
                if dir.starts_with(prefix) {
                    return import_from_github_path(owner, repo, dir, ref_, dest_parent);
                }
            }
        }

        // Try any SKILL.md found
        if let Some(first_dir) = skill_dirs.first() {
            return import_from_github_path(owner, repo, first_dir, ref_, dest_parent);
        }
    }

    // Fallback: try each well-known path directly
    for path in &well_known_paths {
        match import_from_github_path(owner, repo, path, ref_, dest_parent) {
            Ok(result) => return Ok(result),
            Err(_) => continue,
        }
    }

    Err(SkillsError::Import(format!(
        "No SKILL.md found in {owner}/{repo}. Tried root and common skill directories (.github/skills/, .copilot/skills/, .claude/skills/)"
    )))
}

/// Import a skill from a specific path within a GitHub repository.
pub(crate) fn import_from_github_path(
    owner: &str,
    repo: &str,
    base_path: &str,
    ref_: &str,
    dest_parent: &Path,
) -> Result<SkillImportResult, SkillsError> {
    let skill_md_path = if base_path == "." {
        "SKILL.md".to_string()
    } else {
        format!("{}/SKILL.md", base_path.trim_end_matches('/'))
    };

    // Fetch the SKILL.md
    let content = crate::github::gh_get_file(owner, repo, &skill_md_path, ref_)
        .map_err(|e| SkillsError::GitHub(format!("Failed to fetch SKILL.md: {e}")))?;

    let (fm, _) = parse_skill_md(&content)?;

    let dest_dir = dest_parent.join(&fm.name);
    if dest_dir.exists() {
        return Err(SkillsError::DuplicateSkill(fm.name.clone()));
    }
    std::fs::create_dir_all(&dest_dir)?;
    std::fs::write(dest_dir.join("SKILL.md"), &content)?;

    let mut files_copied = 1;
    let mut warnings = Vec::new();

    // Try to fetch additional files in the skill directory
    match crate::github::gh_list_tree(owner, repo, ref_) {
        Ok(entries) => {
            let prefix = if base_path == "." {
                String::new()
            } else {
                format!("{}/", base_path.trim_end_matches('/'))
            };

            for entry in &entries {
                if entry.entry_type != "blob" {
                    continue;
                }
                if !entry.path.starts_with(&prefix) {
                    continue;
                }
                let relative = &entry.path[prefix.len()..];
                if relative == "SKILL.md" || relative.contains('/') {
                    continue; // Already fetched or in subdirectory
                }

                match crate::github::gh_get_file(owner, repo, &entry.path, ref_) {
                    Ok(file_content) => {
                        std::fs::write(dest_dir.join(relative), file_content)?;
                        files_copied += 1;
                    }
                    Err(e) => {
                        warnings.push(format!("Failed to fetch {}: {e}", relative));
                    }
                }
            }
        }
        Err(e) => {
            warnings.push(format!("Could not list repo tree: {e}. Only SKILL.md was imported."));
        }
    }

    Ok(SkillImportResult {
        skill_name: fm.name,
        destination: dest_dir.to_string_lossy().to_string(),
        warnings,
        files_copied,
    })
}

/// Copy all files from a source directory to a destination.
fn copy_dir_contents(src: &Path, dst: &Path) -> Result<usize, SkillsError> {
    std::fs::create_dir_all(dst)?;
    let mut count = 0;

    for entry in std::fs::read_dir(src)?.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            count += copy_dir_contents(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
            count += 1;
        }
    }

    Ok(count)
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

    // If explicit path given, use it directly
    if let Some(base_path) = skill_path {
        return preview_github_import_path(owner, repo, base_path, ref_);
    }

    let well_known_paths = [
        ".",
        ".github/skills",
        ".copilot/skills",
        ".claude/skills",
    ];

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

        let has_root = entries
            .iter()
            .any(|e| e.entry_type == "blob" && e.path == "SKILL.md");

        if has_root {
            return preview_github_import_path(owner, repo, ".", ref_);
        }

        for prefix in &well_known_paths[1..] {
            for dir in &skill_dirs {
                if dir.starts_with(prefix) {
                    return preview_github_import_path(owner, repo, dir, ref_);
                }
            }
        }

        if let Some(first_dir) = skill_dirs.first() {
            return preview_github_import_path(owner, repo, first_dir, ref_);
        }
    }

    // Fallback: try each well-known path directly
    for path in &well_known_paths {
        match preview_github_import_path(owner, repo, path, ref_) {
            Ok(result) => return Ok(result),
            Err(_) => continue,
        }
    }

    Err(SkillsError::Import(format!(
        "No SKILL.md found in {owner}/{repo}. Tried root and common skill directories (.github/skills/, .copilot/skills/, .claude/skills/)"
    )))
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
        .map_err(|e| SkillsError::GitHub(format!("Failed to fetch SKILL.md: {e}")))?;

    let (fm, _) = parse_skill_md(&content)?;

    // List files that would be imported
    let mut files = vec!["SKILL.md".to_string()];
    if let Ok(entries) = crate::github::gh_list_tree(owner, repo, ref_) {
        let prefix = if base_path == "." {
            String::new()
        } else {
            format!("{}/", base_path.trim_end_matches('/'))
        };
        for entry in &entries {
            if entry.entry_type == "blob" && entry.path.starts_with(&prefix) {
                let relative = &entry.path[prefix.len()..];
                if relative != "SKILL.md" && !relative.contains('/') {
                    files.push(relative.to_string());
                }
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
    crate::github::gh_check_auth()
        .map_err(|e| SkillsError::GitHub(e.to_string()))?;

    let ref_ = git_ref.unwrap_or("HEAD");

    let entries = crate::github::gh_list_tree(owner, repo, ref_)
        .map_err(|e| SkillsError::GitHub(format!("Failed to list repository: {e}")))?;

    // Find all SKILL.md files in the repo
    let skill_md_paths: Vec<&str> = entries
        .iter()
        .filter(|e| e.entry_type == "blob" && (e.path == "SKILL.md" || e.path.ends_with("/SKILL.md")))
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
    let contents = crate::github::gh_get_files_batch(owner, repo, &filtered, ref_)
        .unwrap_or_default();

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
                    let prefix = if skill_dir == "." {
                        String::new()
                    } else {
                        format!("{}/", skill_dir)
                    };
                    let file_count = entries
                        .iter()
                        .filter(|e| {
                            e.entry_type == "blob"
                                && if prefix.is_empty() {
                                    !e.path.contains('/')
                                } else {
                                    e.path.starts_with(&prefix)
                                        && !e.path[prefix.len()..].contains('/')
                                }
                        })
                        .count();

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
    import_from_github_path(owner, repo, skill_path, git_ref.unwrap_or("HEAD"), dest_parent)
}

/// Discover skills within a local repository or directory.
///
/// Searches well-known skill locations and returns previews. The search order is:
/// 1. Direct SKILL.md (the directory itself is a skill)
/// 2. `.github/skills/*/SKILL.md`
/// 3. `.copilot/skills/*/SKILL.md`
/// 4. `skills/*/SKILL.md`
/// 5. `.github/copilot-skills/*/SKILL.md`
pub fn discover_local_skills(base_dir: &Path) -> Result<Vec<LocalSkillPreview>, SkillsError> {
    if !base_dir.is_dir() {
        return Err(SkillsError::Import(format!(
            "'{}' is not a directory",
            base_dir.display()
        )));
    }

    let mut previews = Vec::new();

    // 1. Check if the directory itself is a skill
    let root_skill_md = base_dir.join("SKILL.md");
    if root_skill_md.exists() {
        if let Ok(preview) = skill_preview_from_dir(base_dir) {
            previews.push(preview);
            return Ok(previews);
        }
    }

    // 2–5. Search well-known sub-directory patterns
    let search_parents = [
        ".github/skills",
        ".copilot/skills",
        "skills",
        ".github/copilot-skills",
    ];

    for parent_rel in &search_parents {
        let parent_dir = base_dir.join(parent_rel);
        if !parent_dir.is_dir() {
            continue;
        }
        let entries = std::fs::read_dir(&parent_dir)?;
        for entry in entries.flatten() {
            let skill_dir = entry.path();
            if !skill_dir.is_dir() {
                continue;
            }
            if skill_dir.join("SKILL.md").exists() {
                if let Ok(preview) = skill_preview_from_dir(&skill_dir) {
                    previews.push(preview);
                }
            }
        }
    }

    Ok(previews)
}

/// Build a `LocalSkillPreview` from a directory that contains SKILL.md.
fn skill_preview_from_dir(skill_dir: &Path) -> Result<LocalSkillPreview, SkillsError> {
    let skill_md = skill_dir.join("SKILL.md");
    let content = std::fs::read_to_string(&skill_md)?;
    let (fm, _) = parse_skill_md(&content)?;

    let file_count = std::fs::read_dir(skill_dir)
        .map(|rd| rd.flatten().filter(|e| e.path().is_file()).count())
        .unwrap_or(1);

    Ok(LocalSkillPreview {
        path: skill_dir.to_string_lossy().to_string(),
        name: fm.name,
        description: fm.description,
        file_count,
    })
}

/// Scans multiple repository paths for skills and returns results grouped by repo.
///
/// Each entry in `repos` is a `(path, name)` pair. The function calls
/// [`discover_local_skills`] on each path, collecting results even if some repos
/// have no skills (they get an empty `skills` vec) or fail (silently skipped).
pub fn discover_repo_skills(repos: &[(&str, &str)]) -> Vec<RepoSkillsResult> {
    repos
        .iter()
        .filter_map(|(path, name)| {
            let dir = Path::new(path);
            if !dir.is_dir() {
                return None;
            }
            let skills = discover_local_skills(dir).unwrap_or_default();
            Some(RepoSkillsResult {
                repo_path: path.to_string(),
                repo_name: name.to_string(),
                skills,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_test_skill(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("SKILL.md"),
            "---\nname: test-import\ndescription: Test\n---\n\nBody.\n",
        )
        .unwrap();
    }

    #[test]
    fn import_from_local_copies_files() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();

        write_test_skill(src.path());
        std::fs::write(src.path().join("helper.py"), "# helper").unwrap();

        let result = import_from_local(src.path(), dst.path()).unwrap();
        assert_eq!(result.skill_name, "test-import");
        assert_eq!(result.files_copied, 2);
        assert!(dst.path().join("test-import").join("SKILL.md").exists());
        assert!(dst.path().join("test-import").join("helper.py").exists());
    }

    #[test]
    fn import_from_local_errors_without_skill_md() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();

        let result = import_from_local(src.path(), dst.path());
        assert!(result.is_err());
    }

    #[test]
    fn import_from_local_errors_on_duplicate() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();

        write_test_skill(src.path());
        std::fs::create_dir_all(dst.path().join("test-import")).unwrap();

        let result = import_from_local(src.path(), dst.path());
        assert!(result.is_err());
    }

    #[test]
    fn import_from_file_single_file() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();

        let skill_content = "---\nname: file-skill\ndescription: From file\n---\n\nContent.\n";
        let file_path = src.path().join("my-skill.md");
        std::fs::write(&file_path, skill_content).unwrap();

        let result = import_from_file(&file_path, dst.path()).unwrap();
        assert_eq!(result.skill_name, "file-skill");
        assert_eq!(result.files_copied, 1);
        assert!(dst.path().join("file-skill").join("SKILL.md").exists());
    }

    #[test]
    fn copy_dir_preserves_structure() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();

        std::fs::write(src.path().join("a.txt"), "a").unwrap();
        std::fs::create_dir(src.path().join("sub")).unwrap();
        std::fs::write(src.path().join("sub").join("b.txt"), "b").unwrap();

        let dest = dst.path().join("copied");
        let count = copy_dir_contents(src.path(), &dest).unwrap();
        assert_eq!(count, 2);
        assert!(dest.join("a.txt").exists());
        assert!(dest.join("sub").join("b.txt").exists());
    }

    #[test]
    fn discover_repo_skills_finds_skills_in_repos() {
        let repo1 = TempDir::new().unwrap();
        let repo2 = TempDir::new().unwrap();
        let repo_empty = TempDir::new().unwrap();

        // repo1: has a skill in .github/skills/
        let skill_dir = repo1.path().join(".github").join("skills").join("test-skill");
        write_test_skill(&skill_dir);

        // repo2: has a skill directly in .copilot/skills/
        let skill_dir2 = repo2.path().join(".copilot").join("skills").join("another-skill");
        std::fs::create_dir_all(&skill_dir2).unwrap();
        std::fs::write(
            skill_dir2.join("SKILL.md"),
            "---\nname: another-skill\ndescription: Another test\n---\n\nBody.\n",
        )
        .unwrap();

        let repos = vec![
            (repo1.path().to_str().unwrap(), "Repo One"),
            (repo2.path().to_str().unwrap(), "Repo Two"),
            (repo_empty.path().to_str().unwrap(), "Empty Repo"),
        ];

        let results = discover_repo_skills(&repos);

        // Empty repo should still appear (with 0 skills)
        assert_eq!(results.len(), 3);

        let r1 = results.iter().find(|r| r.repo_name == "Repo One").unwrap();
        assert_eq!(r1.skills.len(), 1);
        assert_eq!(r1.skills[0].name, "test-import");

        let r2 = results.iter().find(|r| r.repo_name == "Repo Two").unwrap();
        assert_eq!(r2.skills.len(), 1);
        assert_eq!(r2.skills[0].name, "another-skill");

        let r3 = results.iter().find(|r| r.repo_name == "Empty Repo").unwrap();
        assert_eq!(r3.skills.len(), 0);
    }

    #[test]
    fn discover_repo_skills_skips_nonexistent_paths() {
        let repos = vec![
            ("C:\\nonexistent\\path\\12345", "Missing"),
        ];
        let results = discover_repo_skills(&repos);
        assert_eq!(results.len(), 0);
    }
}
