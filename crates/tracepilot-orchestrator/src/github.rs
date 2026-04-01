//! GitHub CLI (`gh`) wrapper for authenticated API operations.
//!
//! Provides helper functions for checking auth status, fetching file
//! contents, and listing repo trees — all via the `gh` CLI binary.
//! This enables GitHub operations (including private repos) without
//! requiring TracePilot to manage OAuth tokens directly.

use crate::error::{OrchestratorError, Result};
use crate::process::{run_hidden, run_hidden_stdout_timeout};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Timeout in seconds for individual `gh api` network calls.
const GH_TIMEOUT_SECS: u64 = 30;

/// Run a `gh` command with timeout and GitHub-specific error messages.
///
/// Wraps timeout errors with network-specific guidance while preserving
/// command details for debugging.
fn gh_run_with_timeout(args: &[&str], cwd: Option<&Path>) -> Result<String> {
    run_hidden_stdout_timeout("gh", args, cwd, GH_TIMEOUT_SECS).map_err(|e| {
        let err_msg = e.to_string();
        if err_msg.contains("Command timed out") {
            OrchestratorError::Launch(format!(
                "GitHub API call timed out after {GH_TIMEOUT_SECS}s. \
                 Check your internet connection and try again."
            ))
        } else {
            e
        }
    })
}

/// Information about the current `gh` CLI authentication state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhAuthInfo {
    pub authenticated: bool,
    pub username: Option<String>,
}

/// A single entry from a GitHub repository tree listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub path: String,
    /// "blob" for files, "tree" for directories
    #[serde(rename = "type")]
    pub entry_type: String,
    pub size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GhTreeResponse {
    tree: Vec<GhTreeEntry>,
}

#[derive(Debug, Deserialize)]
struct GhTreeEntry {
    path: String,
    #[serde(rename = "type")]
    entry_type: String,
    size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GhContentResponse {
    content: String,
}

#[derive(Debug, Clone, Default)]
pub struct GitHubFileContent {
    pub text: Option<String>,
    pub bytes: Option<Vec<u8>>,
}

/// Check if the `gh` CLI is installed and authenticated.
///
/// Uses `gh auth status` and parses the output. Returns `authenticated: false`
/// rather than an error when `gh` is installed but not logged in.
pub fn gh_auth_status() -> Result<GhAuthInfo> {
    let output = run_hidden("gh", &["auth", "status", "--hostname", "github.com"], None, Some(15))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = format!("{stdout}{stderr}");
    // Parse username from output like "✓ Logged in to github.com account username"
    let username = combined
        .lines()
        .find(|line| line.contains("Logged in") || line.contains("account"))
        .and_then(|line| line.split_whitespace().last())
        .map(|s| s.to_string());

    Ok(GhAuthInfo {
        authenticated: output.status.success(),
        username,
    })
}

/// Verify that `gh` is installed and the user is authenticated.
///
/// Returns a clear, actionable error message rather than hanging or returning
/// an opaque failure. Call this before any API operations.
pub fn gh_check_auth() -> Result<()> {
    let version_check = run_hidden("gh", &["--version"], None, Some(5));
    let is_installed = version_check.map(|o| o.status.success()).unwrap_or(false);
    if !is_installed {
        return Err(OrchestratorError::Launch(
            "The `gh` CLI is not installed or could not be found. \
             Install it from https://cli.github.com/ to import from GitHub."
                .into(),
        ));
    }

    let auth = gh_auth_status()?;
    if !auth.authenticated {
        return Err(OrchestratorError::Launch(
            "Not authenticated with GitHub. \
             Run `gh auth login` in your terminal and try again."
                .into(),
        ));
    }
    Ok(())
}

/// Fetch the contents of a single file from a GitHub repository.
///
/// Uses the GitHub Contents API via `gh api` with a 15-second timeout.
/// The content is returned base64-encoded by the API and decoded here.
pub fn gh_get_file(owner: &str, repo: &str, path: &str, ref_: &str) -> Result<String> {
    let bytes = gh_get_file_bytes(owner, repo, path, ref_)?;
    String::from_utf8(bytes)
        .map_err(|e| OrchestratorError::Launch(format!("File content is not valid UTF-8: {e}")))
}

/// Fetch the contents of a single file from a GitHub repository as raw bytes.
pub fn gh_get_file_bytes(owner: &str, repo: &str, path: &str, ref_: &str) -> Result<Vec<u8>> {
    let api_path = format!("/repos/{owner}/{repo}/contents/{path}?ref={ref_}");
    let json = gh_run_with_timeout(&["api", &api_path], None)?;

    let response: GhContentResponse = serde_json::from_str(&json).map_err(|e| {
        OrchestratorError::Launch(format!("Failed to parse GitHub API response: {e}"))
    })?;

    // GitHub returns base64-encoded content (with newlines)
    let cleaned = response.content.replace('\n', "");
    base64_decode(&cleaned).map_err(|e| {
        OrchestratorError::Launch(format!("Failed to decode base64 content: {e}"))
    })
}

/// List the file tree of a GitHub repository at a given ref.
///
/// Uses the Git Trees API with `recursive=1` and a 30-second timeout.
pub fn gh_list_tree(owner: &str, repo: &str, ref_: &str) -> Result<Vec<TreeEntry>> {
    let api_path = format!("/repos/{owner}/{repo}/git/trees/{ref_}?recursive=1");
    let json = gh_run_with_timeout(&["api", &api_path], None)?;

    let response: GhTreeResponse = serde_json::from_str(&json).map_err(|e| {
        OrchestratorError::Launch(format!("Failed to parse GitHub tree response: {e}"))
    })?;

    Ok(response
        .tree
        .into_iter()
        .map(|e| TreeEntry {
            path: e.path,
            entry_type: e.entry_type,
            size: e.size,
        })
        .collect())
}

/// Batch-fetch multiple file contents from a GitHub repo using GraphQL.
///
/// Fetches all requested paths in as few API calls as possible (batches of 25)
/// rather than spawning a separate `gh api` process per file. This can reduce
/// N sequential calls down to ⌈N/25⌉ calls.
///
/// Returns a map of path → content for files that exist and are non-empty.
pub fn gh_get_files_batch(
    owner: &str,
    repo: &str,
    paths: &[&str],
    git_ref: &str,
) -> Result<HashMap<String, String>> {
    if paths.is_empty() {
        return Ok(HashMap::new());
    }

    let mut all_results = HashMap::new();

    // Sanitise all interpolated values to prevent GraphQL injection.
    let safe_owner = owner.replace('"', "");
    let safe_repo = repo.replace('"', "");

    // Process in batches of 25 to stay within GraphQL response size limits.
    for chunk in paths.chunks(25) {
        let mut fields = Vec::new();
        for (i, path) in chunk.iter().enumerate() {
            let safe_ref = git_ref.replace('"', "");
            let safe_path = path.replace('"', "");
            fields.push(format!(
                "file{i}: object(expression: \"{safe_ref}:{safe_path}\") {{ ... on Blob {{ text }} }}"
            ));
        }

        let query = format!(
            "query {{ repository(owner: \"{safe_owner}\", name: \"{safe_repo}\") {{ {} }} }}",
            fields.join(" ")
        );

        let output = gh_run_with_timeout(
            &["api", "graphql", "-f", &format!("query={query}")],
            None,
        )?;

        let json: serde_json::Value = serde_json::from_str(&output)
            .map_err(|e| OrchestratorError::Launch(format!("GraphQL parse error: {e}")))?;

        if let Some(repo_data) = json.get("data").and_then(|d| d.get("repository")) {
            for (i, path) in chunk.iter().enumerate() {
                let key = format!("file{i}");
                if let Some(text) = repo_data
                    .get(&key)
                    .and_then(|obj| obj.get("text"))
                    .and_then(|t| t.as_str())
                {
                    all_results.insert(path.to_string(), text.to_string());
                }
            }
        }
    }

    Ok(all_results)
}

/// Fetch multiple files from a GitHub repo, preserving both text and binary content.
///
/// Text files are fetched in GraphQL batches for performance. Any paths not returned by
/// GraphQL are then fetched individually via the Contents API so binary assets like fonts
/// and images still import correctly.
pub fn gh_get_files_batch_with_binary(
    owner: &str,
    repo: &str,
    paths: &[&str],
    git_ref: &str,
) -> Result<HashMap<String, GitHubFileContent>> {
    if paths.is_empty() {
        return Ok(HashMap::new());
    }

    let text_results = gh_get_files_batch(owner, repo, paths, git_ref)?;
    let mut results: HashMap<String, GitHubFileContent> = text_results
        .into_iter()
        .map(|(path, text)| {
            (
                path,
                GitHubFileContent {
                    text: Some(text),
                    bytes: None,
                },
            )
        })
        .collect();

    for path in paths {
        if results.contains_key(*path) {
            continue;
        }
        let bytes = gh_get_file_bytes(owner, repo, path, git_ref)?;
        results.insert(
            (*path).to_string(),
            GitHubFileContent {
                text: String::from_utf8(bytes.clone()).ok(),
                bytes: Some(bytes),
            },
        );
    }

    Ok(results)
}

/// Minimal base64 decoder (avoids adding a crate dependency).
fn base64_decode(input: &str) -> std::result::Result<Vec<u8>, String> {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    fn val(c: u8) -> std::result::Result<u8, String> {
        if let Some(pos) = CHARS.iter().position(|&x| x == c) {
            Ok(pos as u8)
        } else if c == b'=' {
            Ok(0)
        } else {
            Err(format!("Invalid base64 character: {}", c as char))
        }
    }

    let bytes: Vec<u8> = input.bytes().filter(|&b| b != b'\n' && b != b'\r').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);

    for chunk in bytes.chunks(4) {
        if chunk.len() < 2 {
            break;
        }
        let a = val(chunk[0])?;
        let b = val(chunk[1])?;
        out.push((a << 2) | (b >> 4));

        if chunk.len() > 2 && chunk[2] != b'=' {
            let c = val(chunk[2])?;
            out.push(((b & 0x0f) << 4) | (c >> 2));

            if chunk.len() > 3 && chunk[3] != b'=' {
                let d = val(chunk[3])?;
                out.push(((c & 0x03) << 6) | d);
            }
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_decode_simple() {
        let decoded = base64_decode("SGVsbG8gV29ybGQ=").unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), "Hello World");
    }

    #[test]
    fn base64_decode_no_padding() {
        let decoded = base64_decode("YQ").unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), "a");
    }

    #[test]
    fn base64_decode_with_newlines() {
        let decoded = base64_decode("SGVs\nbG8=").unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), "Hello");
    }

    #[test]
    fn gh_auth_returns_info_when_gh_not_installed() {
        // This test will work even if gh is not installed — it should
        // return authenticated: false rather than panicking
        let info = gh_auth_status();
        // Don't assert specific values — just verify it doesn't crash
        assert!(info.is_ok());
    }

    #[test]
    fn github_file_content_defaults_empty() {
        let content = GitHubFileContent::default();
        assert!(content.text.is_none());
        assert!(content.bytes.is_none());
    }
}
