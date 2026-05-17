//! Skills Tauri commands (16 commands).

use std::collections::BTreeMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};

use crate::blocking_cmd;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::EncounteredSkillSummary;
use serde::Deserialize;

/// Validate that a skill_dir is within a known skills root before any operation.
fn check_skill_dir(skill_dir: &str) -> Result<(), tracepilot_orchestrator::skills::SkillsError> {
    tracepilot_orchestrator::skills::manager::validate_skill_dir(Path::new(skill_dir))
}

fn normalize_skill_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn is_user_global_copilot_skill_path(normalized_path: &str) -> bool {
    let segments: Vec<&str> = normalized_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();

    segments.windows(4).any(|window| {
        matches!(window[0], "users" | "home") && window[2] == ".copilot" && window[3] == "skills"
    })
}

fn is_project_skill_path(path: &str) -> bool {
    let normalized = normalize_path(path);
    if normalized.contains("/.github/skills/") {
        return true;
    }
    if !normalized.contains("/.copilot/skills/") {
        return false;
    }
    if is_user_global_copilot_skill_path(&normalized) {
        return false;
    }
    if let Ok(global_dir) = tracepilot_orchestrator::skills::discovery::global_skills_dir() {
        let path = Path::new(path);
        if path.starts_with(&global_dir) {
            return false;
        }
        if let (Ok(path_canon), Ok(global_canon)) = (path.canonicalize(), global_dir.canonicalize())
            && path_canon.starts_with(global_canon)
        {
            return false;
        }
    }
    true
}

fn skill_directory_from_path(path: &str) -> Option<String> {
    let skill_path = PathBuf::from(path);
    if !skill_path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .is_some_and(|file_name| file_name.eq_ignore_ascii_case("SKILL.md"))
    {
        return None;
    }
    skill_path
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
}

fn estimate_tokens(content: Option<&str>) -> usize {
    content
        .map(|content| content.chars().count().div_ceil(4))
        .unwrap_or(0)
}

fn read_skill_invocations(events_path: &Path) -> Result<Vec<SkillInvokedPayload>, std::io::Error> {
    let file = match std::fs::File::open(events_path) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    let reader = std::io::BufReader::new(file);
    let mut invocations = Vec::new();

    for line in reader.lines() {
        let line = line?;
        if !line.contains("skill.invoked") {
            continue;
        }
        let Ok(envelope) = serde_json::from_str::<SkillInvokedEnvelope>(&line) else {
            continue;
        };
        if envelope.event_type == "skill.invoked" {
            invocations.push(envelope.data);
        }
    }

    Ok(invocations)
}

fn choose_display_name(previous: &str, next: &str) -> String {
    if previous <= next {
        previous.to_string()
    } else {
        next.to_string()
    }
}

fn choose_description(previous: &str, next: &str) -> String {
    match previous.len().cmp(&next.len()) {
        std::cmp::Ordering::Greater => previous.to_string(),
        std::cmp::Ordering::Less => next.to_string(),
        std::cmp::Ordering::Equal => {
            if previous <= next {
                previous.to_string()
            } else {
                next.to_string()
            }
        }
    }
}

fn choose_path(previous: &str, next: &str) -> String {
    if normalize_path(previous) <= normalize_path(next) {
        previous.to_string()
    } else {
        next.to_string()
    }
}

fn merge_encountered_skill(
    discovered: &mut BTreeMap<String, EncounteredAccumulator>,
    key: &str,
    next: EncounteredAccumulator,
) {
    let Some(previous) = discovered.get_mut(key) else {
        discovered.insert(key.to_string(), next);
        return;
    };

    previous.name = choose_display_name(&previous.name, &next.name);
    previous.description = choose_description(&previous.description, &next.description);
    previous.directory = choose_path(&previous.directory, &next.directory);
    previous.source_path = choose_path(&previous.source_path, &next.source_path);
    previous.estimated_tokens = previous.estimated_tokens.max(next.estimated_tokens);
    previous.invocation_count += next.invocation_count;
}

// -- Discovery --

#[tauri::command]
#[tracing::instrument(skip(repo_root), err)]
pub async fn skills_list_all(
    repo_root: Option<String>,
) -> CmdResult<Vec<tracepilot_orchestrator::skills::types::SkillSummary>> {
    blocking_cmd!(tracepilot_orchestrator::skills::discovery::discover_all(
        repo_root.as_deref().map(Path::new),
    ))
}

#[derive(Debug)]
struct EncounteredAccumulator {
    name: String,
    description: String,
    directory: String,
    estimated_tokens: usize,
    source_path: String,
    invocation_count: usize,
}

#[derive(Debug, Deserialize)]
struct SkillInvokedEnvelope {
    #[serde(rename = "type")]
    event_type: String,
    data: SkillInvokedPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillInvokedPayload {
    name: Option<String>,
    path: Option<String>,
    content: Option<String>,
    description: Option<String>,
}

#[tauri::command]
#[tracing::instrument(skip_all, err)]
pub async fn skills_encountered_project(
    state: tauri::State<'_, crate::config::SharedConfig>,
    installed_names: Vec<String>,
    limit: Option<usize>,
) -> CmdResult<Vec<EncounteredSkillSummary>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let installed_names: std::collections::HashSet<String> = installed_names
        .into_iter()
        .map(|name| normalize_skill_name(&name))
        .collect();
    let limit = limit.unwrap_or(100).min(500);

    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        let candidates = db.recent_skill_call_candidates(limit)?;
        let mut targets_by_session = Vec::<(PathBuf, BTreeMap<String, (String, usize)>)>::new();
        let mut session_indexes = BTreeMap::<PathBuf, usize>::new();

        for candidate in candidates {
            let normalized_name = normalize_skill_name(&candidate.normalized_name);
            if installed_names.contains(&normalized_name) {
                continue;
            }

            let index = if let Some(index) = session_indexes.get(&candidate.session_path) {
                *index
            } else {
                let index = targets_by_session.len();
                session_indexes.insert(candidate.session_path.clone(), index);
                targets_by_session.push((candidate.session_path, BTreeMap::new()));
                index
            };

            targets_by_session[index]
                .1
                .entry(normalized_name)
                .or_insert((candidate.display_name, candidate.invocation_count));
        }

        let mut discovered = BTreeMap::<String, EncounteredAccumulator>::new();

        for (session_path, targets) in targets_by_session {
            let events_path =
                tracepilot_core::paths::SessionPaths::from_root(&session_path).events_jsonl();
            let invocations = match read_skill_invocations(&events_path) {
                Ok(invocations) => invocations,
                Err(error) => {
                    tracing::warn!(
                        path = %events_path.display(),
                        error = %error,
                        "Skipping unreadable session events while discovering encountered skills"
                    );
                    continue;
                }
            };

            for data in invocations {
                let Some(name) = data
                    .name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                else {
                    continue;
                };
                let normalized_name = normalize_skill_name(name);
                if discovered.contains_key(&normalized_name) {
                    continue;
                }
                let Some((display_name, invocation_count)) = targets.get(&normalized_name) else {
                    continue;
                };

                let Some(source_path) = data
                    .path
                    .as_deref()
                    .map(str::trim)
                    .filter(|path| is_project_skill_path(path))
                else {
                    continue;
                };
                let Some(directory) = skill_directory_from_path(source_path) else {
                    continue;
                };

                let description = data
                    .description
                    .as_deref()
                    .map(str::trim)
                    .filter(|desc| !desc.is_empty())
                    .unwrap_or("Encountered in recent CLI sessions");
                let estimated_tokens = estimate_tokens(data.content.as_deref());

                merge_encountered_skill(
                    &mut discovered,
                    &normalized_name,
                    EncounteredAccumulator {
                        name: display_name.to_string(),
                        description: description.to_string(),
                        directory,
                        estimated_tokens,
                        source_path: source_path.to_string(),
                        invocation_count: *invocation_count,
                    },
                );
            }
        }

        Ok::<_, BindingsError>(
            discovered
                .into_values()
                .map(|skill| EncounteredSkillSummary {
                    name: skill.name,
                    description: skill.description,
                    directory: skill.directory,
                    estimated_tokens: skill.estimated_tokens,
                    source_path: skill.source_path,
                    invocation_count: skill.invocation_count,
                })
                .collect(),
        )
    })
}

#[tauri::command]
#[tracing::instrument(skip(skill_dir), level = "debug", err)]
pub async fn skills_get_skill(
    skill_dir: String,
) -> CmdResult<tracepilot_orchestrator::skills::types::Skill> {
    let dir = skill_dir.clone();
    blocking_cmd!(check_skill_dir(&dir).and_then(|_| {
        tracepilot_orchestrator::skills::manager::get_skill(std::path::Path::new(&dir))
    }))
}

// -- CRUD --

#[tauri::command]
#[tracing::instrument(skip(description, body), err, fields(%name, body_len = body.len()))]
pub async fn skills_create(name: String, description: String, body: String) -> CmdResult<String> {
    let sn = crate::validators::validate_skill_name(&name)?;
    blocking_cmd!(
        tracepilot_orchestrator::skills::manager::create_skill(&sn, &description, &body)
            .map(|p| p.to_string_lossy().to_string())
    )
}

#[tauri::command]
#[tracing::instrument(skip(skill_dir, frontmatter, body), err, fields(body_len = body.len()))]
pub async fn skills_update(
    skill_dir: String,
    frontmatter: tracepilot_orchestrator::skills::types::SkillFrontmatter,
    body: String,
) -> CmdResult<()> {
    blocking_cmd!(check_skill_dir(&skill_dir).and_then(|_| {
        tracepilot_orchestrator::skills::manager::update_skill(
            std::path::Path::new(&skill_dir),
            &frontmatter,
            &body,
        )
    }))
}

#[tauri::command]
#[tracing::instrument(skip(skill_dir, raw_content), err, fields(raw_len = raw_content.len()))]
pub async fn skills_update_raw(skill_dir: String, raw_content: String) -> CmdResult<()> {
    blocking_cmd!(check_skill_dir(&skill_dir).and_then(|_| {
        tracepilot_orchestrator::skills::manager::update_skill_raw(
            std::path::Path::new(&skill_dir),
            &raw_content,
        )
    }))
}

#[tauri::command]
#[tracing::instrument(skip(skill_dir), err)]
pub async fn skills_delete(skill_dir: String) -> CmdResult<()> {
    blocking_cmd!(check_skill_dir(&skill_dir).and_then(|_| {
        tracepilot_orchestrator::skills::manager::delete_skill(std::path::Path::new(&skill_dir))
    }))
}

#[tauri::command]
#[tracing::instrument(skip(skill_dir), err, fields(%new_name))]
pub async fn skills_rename(skill_dir: String, new_name: String) -> CmdResult<String> {
    let sn = crate::validators::validate_skill_name(&new_name)?;
    blocking_cmd!(check_skill_dir(&skill_dir).and_then(|_| {
        tracepilot_orchestrator::skills::manager::rename_skill(
            std::path::Path::new(&skill_dir),
            &sn,
        )
        .map(|p| p.to_string_lossy().to_string())
    }))
}

#[tauri::command]
#[tracing::instrument(skip(skill_dir), err, fields(%new_name))]
pub async fn skills_duplicate(skill_dir: String, new_name: String) -> CmdResult<String> {
    let sn = crate::validators::validate_skill_name(&new_name)?;
    blocking_cmd!(check_skill_dir(&skill_dir).and_then(|_| {
        tracepilot_orchestrator::skills::manager::duplicate_skill(
            std::path::Path::new(&skill_dir),
            &sn,
        )
        .map(|p| p.to_string_lossy().to_string())
    }))
}

// -- Assets --

#[tauri::command]
pub async fn skills_list_assets(
    skill_dir: String,
) -> CmdResult<Vec<tracepilot_orchestrator::skills::types::SkillAsset>> {
    blocking_cmd!(check_skill_dir(&skill_dir).and_then(|_| {
        tracepilot_orchestrator::skills::assets::list_assets(std::path::Path::new(&skill_dir))
    }))
}

#[tauri::command]
#[tracing::instrument(skip(skill_dir, content), err, fields(%asset_name, bytes = content.len()))]
pub async fn skills_add_asset(
    skill_dir: String,
    asset_name: String,
    content: Vec<u8>,
) -> CmdResult<()> {
    crate::validators::validate_asset_name(&asset_name)?;
    blocking_cmd!(check_skill_dir(&skill_dir).and_then(|_| {
        tracepilot_orchestrator::skills::assets::add_asset(
            std::path::Path::new(&skill_dir),
            &asset_name,
            &content,
        )
    }))
}

#[tauri::command]
#[tracing::instrument(skip(skill_dir, source_path), err, fields(%asset_name))]
pub async fn skills_copy_asset_from(
    skill_dir: String,
    asset_name: String,
    source_path: String,
) -> CmdResult<()> {
    crate::validators::validate_asset_name(&asset_name)?;
    blocking_cmd!(check_skill_dir(&skill_dir).and_then(|_| {
        tracepilot_orchestrator::skills::assets::copy_asset_from(
            std::path::Path::new(&skill_dir),
            &asset_name,
            std::path::Path::new(&source_path),
        )
    }))
}

#[tauri::command]
#[tracing::instrument(skip(skill_dir), err, fields(%asset_name))]
pub async fn skills_remove_asset(skill_dir: String, asset_name: String) -> CmdResult<()> {
    crate::validators::validate_asset_name(&asset_name)?;
    blocking_cmd!(check_skill_dir(&skill_dir).and_then(|_| {
        tracepilot_orchestrator::skills::assets::remove_asset(
            std::path::Path::new(&skill_dir),
            &asset_name,
        )
    }))
}

#[tauri::command]
pub async fn skills_read_asset(skill_dir: String, asset_name: String) -> CmdResult<String> {
    crate::validators::validate_asset_name(&asset_name)?;
    blocking_cmd!(check_skill_dir(&skill_dir).and_then(|_| {
        tracepilot_orchestrator::skills::assets::read_asset(
            std::path::Path::new(&skill_dir),
            &asset_name,
        )
    }))
}

// -- Import --

/// Resolve the target skills directory based on scope.
fn resolve_skills_dest(
    scope: &str,
    repo_root: Option<&str>,
) -> Result<std::path::PathBuf, crate::error::BindingsError> {
    match scope {
        "project" => {
            if let Some(root) = repo_root {
                Ok(tracepilot_orchestrator::skills::discovery::repo_skills_dir(
                    std::path::Path::new(root),
                ))
            } else {
                Err(crate::error::BindingsError::Validation(
                    "No repository root provided for project scope".into(),
                ))
            }
        }
        _ => Ok(tracepilot_orchestrator::skills::discovery::global_skills_dir()?),
    }
}

#[tauri::command]
#[tracing::instrument(skip(source_dir, repo_root), err, fields(scope = scope.as_deref().unwrap_or("global")))]
pub async fn skills_import_local(
    source_dir: String,
    scope: Option<String>,
    repo_root: Option<String>,
) -> CmdResult<tracepilot_orchestrator::skills::types::SkillImportResult> {
    let scope = scope.unwrap_or_else(|| "global".to_string());
    let dest =
        tokio::task::spawn_blocking(move || resolve_skills_dest(&scope, repo_root.as_deref()))
            .await??;

    blocking_cmd!(tracepilot_orchestrator::skills::import::import_from_local(
        std::path::Path::new(&source_dir),
        &dest,
    ))
}

#[tauri::command]
#[tracing::instrument(skip(file_path, repo_root), err, fields(scope = scope.as_deref().unwrap_or("global")))]
pub async fn skills_import_file(
    file_path: String,
    scope: Option<String>,
    repo_root: Option<String>,
) -> CmdResult<tracepilot_orchestrator::skills::types::SkillImportResult> {
    let scope = scope.unwrap_or_else(|| "global".to_string());
    let dest =
        tokio::task::spawn_blocking(move || resolve_skills_dest(&scope, repo_root.as_deref()))
            .await??;

    blocking_cmd!(tracepilot_orchestrator::skills::import::import_from_file(
        std::path::Path::new(&file_path),
        &dest,
    ))
}

#[tauri::command]
#[tracing::instrument(skip(skill_path, repo_root), err, fields(%owner, %repo, scope = scope.as_deref().unwrap_or("global")))]
pub async fn skills_import_github(
    owner: String,
    repo: String,
    skill_path: Option<String>,
    git_ref: Option<String>,
    scope: Option<String>,
    repo_root: Option<String>,
) -> CmdResult<tracepilot_orchestrator::skills::types::SkillImportResult> {
    let scope = scope.unwrap_or_else(|| "global".to_string());
    let dest =
        tokio::task::spawn_blocking(move || resolve_skills_dest(&scope, repo_root.as_deref()))
            .await??;

    blocking_cmd!(tracepilot_orchestrator::skills::import::import_from_github(
        &owner,
        &repo,
        skill_path.as_deref(),
        git_ref.as_deref(),
        &dest,
    ))
}

// -- Local discovery --

#[tauri::command]
pub async fn skills_discover_local(
    dir: String,
) -> CmdResult<Vec<tracepilot_orchestrator::skills::types::LocalSkillPreview>> {
    blocking_cmd!(
        tracepilot_orchestrator::skills::import::discover_local_skills(std::path::Path::new(&dir),)
    )
}

// -- GitHub auth --

#[tauri::command]
pub async fn skills_gh_auth_status() -> CmdResult<tracepilot_orchestrator::github::GhAuthInfo> {
    blocking_cmd!(tracepilot_orchestrator::github::gh_auth_status())
}

// -- GitHub discovery --

#[tauri::command]
pub async fn skills_discover_github(
    owner: String,
    repo: String,
    path: Option<String>,
    git_ref: Option<String>,
) -> CmdResult<Vec<tracepilot_orchestrator::skills::types::GitHubSkillPreview>> {
    blocking_cmd!(
        tracepilot_orchestrator::skills::import::discover_github_skills(
            &owner,
            &repo,
            path.as_deref(),
            git_ref.as_deref(),
        )
    )
}

#[tauri::command]
pub async fn skills_import_github_skill(
    owner: String,
    repo: String,
    skill_path: String,
    git_ref: Option<String>,
    scope: Option<String>,
    repo_root: Option<String>,
) -> CmdResult<tracepilot_orchestrator::skills::types::SkillImportResult> {
    let scope = scope.unwrap_or_else(|| "global".to_string());
    let dest =
        tokio::task::spawn_blocking(move || resolve_skills_dest(&scope, repo_root.as_deref()))
            .await??;

    blocking_cmd!(
        tracepilot_orchestrator::skills::import::import_github_skill(
            &owner,
            &repo,
            &skill_path,
            git_ref.as_deref(),
            &dest,
        )
    )
}

// -- Repository discovery (batch scan) --

#[tauri::command]
pub async fn skills_discover_repos(
    repos: Vec<(String, String)>,
) -> CmdResult<Vec<tracepilot_orchestrator::skills::types::RepoSkillsResult>> {
    Ok(tokio::task::spawn_blocking(move || {
        let refs: Vec<(&str, &str)> = repos
            .iter()
            .map(|(p, n)| (p.as_str(), n.as_str()))
            .collect();
        tracepilot_orchestrator::skills::import::discover_repo_skills(&refs)
    })
    .await?)
}

#[cfg(test)]
mod encountered_project_tests {
    use super::is_project_skill_path;

    #[test]
    fn project_skill_path_filter_excludes_user_global_skills() {
        assert!(!is_project_skill_path(
            r"C:\Users\alice\.copilot\skills\global-skill\SKILL.md"
        ));
        assert!(!is_project_skill_path(
            "/Users/alice/.copilot/skills/global-skill/SKILL.md"
        ));
        assert!(!is_project_skill_path(
            "/home/alice/.copilot/skills/global-skill/SKILL.md"
        ));
    }

    #[test]
    fn project_skill_path_filter_accepts_repo_skills() {
        assert!(is_project_skill_path(
            r"C:\git\TracePilot\.github\skills\tracepilot-app-automation\SKILL.md"
        ));
        assert!(is_project_skill_path(
            r"C:\git\TracePilot\.copilot\skills\repo-skill\SKILL.md"
        ));
    }
}
