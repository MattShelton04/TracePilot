//! Skills Tauri commands (16 commands).

use crate::error::CmdResult;
use crate::helpers::{spawn_blocking, spawn_blocking_infallible, spawn_blocking_orchestrator};
use tracepilot_orchestrator::OrchestratorError;

/// Helper to convert SkillsError to OrchestratorError inside spawn_blocking.
fn sk<T>(r: Result<T, tracepilot_orchestrator::skills::SkillsError>) -> Result<T, OrchestratorError> {
    r.map_err(OrchestratorError::from)
}

/// Validate that a skill_dir is within a known skills root before any operation.
fn check_skill_dir(skill_dir: &str) -> Result<(), tracepilot_orchestrator::skills::SkillsError> {
    tracepilot_orchestrator::skills::manager::validate_skill_dir(std::path::Path::new(skill_dir))
}

// -- Discovery --

#[tauri::command]
pub async fn skills_list_all(
    repo_root: Option<String>,
) -> CmdResult<Vec<tracepilot_orchestrator::skills::types::SkillSummary>> {
    spawn_blocking_orchestrator(move || {
        sk(tracepilot_orchestrator::skills::discovery::discover_all(
            repo_root.as_deref().map(std::path::Path::new),
        ))
    })
    .await
}

#[tauri::command]
pub async fn skills_get_skill(
    skill_dir: String,
) -> CmdResult<tracepilot_orchestrator::skills::types::Skill> {
    let dir = skill_dir.clone();
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&dir).and_then(|_| {
            tracepilot_orchestrator::skills::manager::get_skill(std::path::Path::new(&dir))
        }))
    })
    .await
}

// -- CRUD --

#[tauri::command]
pub async fn skills_create(
    name: String,
    description: String,
    body: String,
) -> CmdResult<String> {
    spawn_blocking_orchestrator(move || {
        sk(tracepilot_orchestrator::skills::manager::create_skill(&name, &description, &body)
            .map(|p| p.to_string_lossy().to_string()))
    })
    .await
}

#[tauri::command]
pub async fn skills_update(
    skill_dir: String,
    frontmatter: tracepilot_orchestrator::skills::types::SkillFrontmatter,
    body: String,
) -> CmdResult<()> {
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&skill_dir).and_then(|_| {
            tracepilot_orchestrator::skills::manager::update_skill(
                std::path::Path::new(&skill_dir),
                &frontmatter,
                &body,
            )
        }))
    })
    .await
}

#[tauri::command]
pub async fn skills_update_raw(
    skill_dir: String,
    raw_content: String,
) -> CmdResult<()> {
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&skill_dir).and_then(|_| {
            tracepilot_orchestrator::skills::manager::update_skill_raw(
                std::path::Path::new(&skill_dir),
                &raw_content,
            )
        }))
    })
    .await
}

#[tauri::command]
pub async fn skills_delete(skill_dir: String) -> CmdResult<()> {
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&skill_dir).and_then(|_| {
            tracepilot_orchestrator::skills::manager::delete_skill(std::path::Path::new(&skill_dir))
        }))
    })
    .await
}

#[tauri::command]
pub async fn skills_rename(
    skill_dir: String,
    new_name: String,
) -> CmdResult<String> {
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&skill_dir).and_then(|_| {
            tracepilot_orchestrator::skills::manager::rename_skill(
                std::path::Path::new(&skill_dir),
                &new_name,
            )
            .map(|p| p.to_string_lossy().to_string())
        }))
    })
    .await
}

#[tauri::command]
pub async fn skills_duplicate(
    skill_dir: String,
    new_name: String,
) -> CmdResult<String> {
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&skill_dir).and_then(|_| {
            tracepilot_orchestrator::skills::manager::duplicate_skill(
                std::path::Path::new(&skill_dir),
                &new_name,
            )
            .map(|p| p.to_string_lossy().to_string())
        }))
    })
    .await
}

// -- Assets --

#[tauri::command]
pub async fn skills_list_assets(
    skill_dir: String,
) -> CmdResult<Vec<tracepilot_orchestrator::skills::types::SkillAsset>> {
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&skill_dir).and_then(|_| {
            tracepilot_orchestrator::skills::assets::list_assets(std::path::Path::new(&skill_dir))
        }))
    })
    .await
}

#[tauri::command]
pub async fn skills_add_asset(
    skill_dir: String,
    asset_name: String,
    content: Vec<u8>,
) -> CmdResult<()> {
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&skill_dir).and_then(|_| {
            tracepilot_orchestrator::skills::assets::add_asset(
                std::path::Path::new(&skill_dir),
                &asset_name,
                &content,
            )
        }))
    })
    .await
}

#[tauri::command]
pub async fn skills_copy_asset_from(
    skill_dir: String,
    asset_name: String,
    source_path: String,
) -> CmdResult<()> {
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&skill_dir).and_then(|_| {
            tracepilot_orchestrator::skills::assets::copy_asset_from(
                std::path::Path::new(&skill_dir),
                &asset_name,
                std::path::Path::new(&source_path),
            )
        }))
    })
    .await
}

#[tauri::command]
pub async fn skills_remove_asset(
    skill_dir: String,
    asset_name: String,
) -> CmdResult<()> {
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&skill_dir).and_then(|_| {
            tracepilot_orchestrator::skills::assets::remove_asset(
                std::path::Path::new(&skill_dir),
                &asset_name,
            )
        }))
    })
    .await
}

#[tauri::command]
pub async fn skills_read_asset(
    skill_dir: String,
    asset_name: String,
) -> CmdResult<String> {
    spawn_blocking_orchestrator(move || {
        sk(check_skill_dir(&skill_dir).and_then(|_| {
            tracepilot_orchestrator::skills::assets::read_asset(
                std::path::Path::new(&skill_dir),
                &asset_name,
            )
        }))
    })
    .await
}

// -- Import --

/// Resolve the target skills directory based on scope.
fn resolve_skills_dest(scope: &str, repo_root: Option<&str>) -> Result<std::path::PathBuf, crate::error::BindingsError> {
    match scope {
        "project" => {
            if let Some(root) = repo_root {
                Ok(tracepilot_orchestrator::skills::discovery::repo_skills_dir(std::path::Path::new(root)))
            } else {
                Err(crate::error::BindingsError::Validation("No repository root provided for project scope".into()))
            }
        }
        _ => Ok(tracepilot_orchestrator::skills::discovery::global_skills_dir()?),
    }
}

#[tauri::command]
pub async fn skills_import_local(
    source_dir: String,
    scope: Option<String>,
    repo_root: Option<String>,
) -> CmdResult<tracepilot_orchestrator::skills::types::SkillImportResult> {
    let dest = spawn_blocking(move || {
        resolve_skills_dest(scope.as_deref().unwrap_or("global"), repo_root.as_deref())
    })
    .await?;

    spawn_blocking_orchestrator(move || {
        sk(tracepilot_orchestrator::skills::import::import_from_local(
            std::path::Path::new(&source_dir),
            &dest,
        ))
    })
    .await
}

#[tauri::command]
pub async fn skills_import_file(
    file_path: String,
    scope: Option<String>,
    repo_root: Option<String>,
) -> CmdResult<tracepilot_orchestrator::skills::types::SkillImportResult> {
    let dest = spawn_blocking(move || {
        resolve_skills_dest(scope.as_deref().unwrap_or("global"), repo_root.as_deref())
    })
    .await?;

    spawn_blocking_orchestrator(move || {
        sk(tracepilot_orchestrator::skills::import::import_from_file(
            std::path::Path::new(&file_path),
            &dest,
        ))
    })
    .await
}

#[tauri::command]
pub async fn skills_import_github(
    owner: String,
    repo: String,
    skill_path: Option<String>,
    git_ref: Option<String>,
    scope: Option<String>,
    repo_root: Option<String>,
) -> CmdResult<tracepilot_orchestrator::skills::types::SkillImportResult> {
    let dest = spawn_blocking(move || {
        resolve_skills_dest(scope.as_deref().unwrap_or("global"), repo_root.as_deref())
    })
    .await?;

    spawn_blocking_orchestrator(move || {
        sk(tracepilot_orchestrator::skills::import::import_from_github(
            &owner,
            &repo,
            skill_path.as_deref(),
            git_ref.as_deref(),
            &dest,
        ))
    })
    .await
}

// -- Local discovery --

#[tauri::command]
pub async fn skills_discover_local(
    dir: String,
) -> CmdResult<Vec<tracepilot_orchestrator::skills::types::LocalSkillPreview>> {
    spawn_blocking_orchestrator(move || {
        sk(tracepilot_orchestrator::skills::import::discover_local_skills(
            std::path::Path::new(&dir),
        ))
    })
    .await
}

// -- GitHub auth --

#[tauri::command]
pub async fn skills_gh_auth_status(
) -> CmdResult<tracepilot_orchestrator::github::GhAuthInfo> {
    spawn_blocking_orchestrator(|| {
        tracepilot_orchestrator::github::gh_auth_status()
    })
    .await
}

// -- GitHub discovery --

#[tauri::command]
pub async fn skills_discover_github(
    owner: String,
    repo: String,
    path: Option<String>,
    git_ref: Option<String>,
) -> CmdResult<Vec<tracepilot_orchestrator::skills::types::GitHubSkillPreview>> {
    spawn_blocking_orchestrator(move || {
        sk(tracepilot_orchestrator::skills::import::discover_github_skills(
            &owner,
            &repo,
            path.as_deref(),
            git_ref.as_deref(),
        ))
    })
    .await
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
    let dest = spawn_blocking(move || {
        resolve_skills_dest(scope.as_deref().unwrap_or("global"), repo_root.as_deref())
    })
    .await?;

    spawn_blocking_orchestrator(move || {
        sk(tracepilot_orchestrator::skills::import::import_github_skill(
            &owner,
            &repo,
            &skill_path,
            git_ref.as_deref(),
            &dest,
        ))
    })
    .await
}

// -- Repository discovery (batch scan) --

#[tauri::command]
pub async fn skills_discover_repos(
    repos: Vec<(String, String)>,
) -> CmdResult<Vec<tracepilot_orchestrator::skills::types::RepoSkillsResult>> {
    spawn_blocking_infallible(move || {
        let refs: Vec<(&str, &str)> = repos.iter().map(|(p, n)| (p.as_str(), n.as_str())).collect();
        tracepilot_orchestrator::skills::import::discover_repo_skills(&refs)
    })
    .await
}
