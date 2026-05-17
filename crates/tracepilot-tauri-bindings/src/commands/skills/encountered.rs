use std::collections::BTreeMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};

use crate::blocking_cmd;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::EncounteredSkillSummary;
use serde::Deserialize;

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

#[cfg(test)]
mod tests {
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
