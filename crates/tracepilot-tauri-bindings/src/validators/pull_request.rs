//! Pull request identity validation (host, owner, repository, number).

use tracepilot_core::pull_requests::PullRequestKey;

use super::rules::truncate_for_display;
use crate::error::{BindingsError, CmdResult};

/// Validate a pull request named over IPC with the grammar the extractor
/// keeps: a DNS host name (no scheme or path), a GitHub owner and repository
/// name, and a number from 1 to 999,999,999.
pub(crate) fn validate_pull_request_key(
    host: &str,
    owner: &str,
    repo: &str,
    number: u32,
) -> CmdResult<PullRequestKey> {
    let key = PullRequestKey {
        host: host.to_string(),
        owner: owner.to_string(),
        repo: repo.to_string(),
        number,
    };
    if key.is_valid() {
        return Ok(key);
    }
    Err(BindingsError::Validation(format!(
        "Invalid pull request: expected host, owner, repository and number, got '{}', '{}', '{}', {number}",
        truncate_for_display(host, 64),
        truncate_for_display(owner, 64),
        truncate_for_display(repo, 64),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pull_request_keys_with_extractor_grammar_pass() {
        let key = validate_pull_request_key("GitHub.com", "Example", "ORCHARD", 58).unwrap();
        assert_eq!(
            (
                key.host.as_str(),
                key.owner.as_str(),
                key.repo.as_str(),
                key.number
            ),
            ("GitHub.com", "Example", "ORCHARD", 58)
        );
        assert!(validate_pull_request_key("ghe.example.com", "e", "o.rs", 999_999_999).is_ok());
    }

    #[test]
    fn malformed_pull_request_keys_are_validation_errors() {
        let long_host = format!("{}.com", "a".repeat(250));
        for (host, owner, repo, number) in [
            ("github.com", "example", "orchard", 0),
            ("github.com", "example", "orchard", 1_000_000_000),
            ("https://github.com", "example", "orchard", 1),
            ("github.com/example", "example", "orchard", 1),
            (long_host.as_str(), "example", "orchard", 1),
            ("github.com", "a/b", "c", 1),
            ("github.com", "a", "b c", 1),
            ("github.com", "'; DROP", "orchard", 1),
            ("github.com", "example", "", 1),
        ] {
            let err = validate_pull_request_key(host, owner, repo, number).unwrap_err();
            assert!(
                matches!(err, crate::error::BindingsError::Validation(_)),
                "{host} {owner} {repo} {number}: {err}"
            );
            assert!(err.to_string().contains("Invalid pull request"), "{err}");
        }
    }
}
