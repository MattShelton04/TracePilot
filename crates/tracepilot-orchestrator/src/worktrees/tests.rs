use super::cache::{disk_usage_bytes, invalidate_disk_usage_cache};
use super::parser::{parse_porcelain_output, paths_equal, sanitize_branch_name};
use std::fs;
use tempfile::tempdir;

#[test]
fn test_sanitize_branch_name() {
    assert_eq!(
        sanitize_branch_name("feature/my-feature"),
        "feature-my-feature"
    );
    assert_eq!(sanitize_branch_name("my branch"), "my-branch");
    assert_eq!(sanitize_branch_name("test~1"), "test-1");
    assert_eq!(sanitize_branch_name("foo^bar"), "foo-bar");
    assert_eq!(sanitize_branch_name("a:b?c*d"), "a-b-c-d");
    assert_eq!(sanitize_branch_name("a[b]c"), "a-b-c");
    assert_eq!(sanitize_branch_name("a\\b"), "a-b");
    assert_eq!(sanitize_branch_name("a<b>c"), "a-b-c");
    assert_eq!(sanitize_branch_name("a|b"), "a-b");
    assert_eq!(sanitize_branch_name("clean-name"), "clean-name");
}

#[test]
fn test_parse_porcelain_empty() {
    let result = parse_porcelain_output("", "/repo").unwrap();
    assert!(result.is_empty());
}

#[test]
fn test_parse_porcelain_single() {
    let input = "worktree /home/user/repo\nHEAD abc1234def\nbranch refs/heads/main\n";
    let result = parse_porcelain_output(input, "/home/user/repo").unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].branch, "main");
    assert_eq!(result[0].head_commit, "abc1234");
    assert!(result[0].is_main_worktree);
    assert!(!result[0].is_locked);
    assert_eq!(result[0].repo_root, "/home/user/repo");
}

#[test]
fn test_parse_porcelain_multiple() {
    let input = "\
worktree /home/user/repo
HEAD abc1234def
branch refs/heads/main

worktree /home/user/repo-feature
HEAD def5678abc
branch refs/heads/feature/thing
";
    let result = parse_porcelain_output(input, "/home/user/repo").unwrap();
    assert_eq!(result.len(), 2);
    assert!(result[0].is_main_worktree);
    assert!(!result[1].is_main_worktree);
    assert_eq!(result[1].branch, "feature/thing");
}

#[test]
fn test_parse_porcelain_bare() {
    let input = "worktree /home/user/repo.git\nHEAD 0000000\nbare\n";
    let result = parse_porcelain_output(input, "/home/user/repo.git").unwrap();
    assert_eq!(result.len(), 1);
    assert!(result[0].is_bare);
}

#[test]
fn test_parse_porcelain_detached() {
    let input = "worktree /home/user/repo\nHEAD abc1234def\ndetached\n";
    let result = parse_porcelain_output(input, "/home/user/repo").unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].branch, "(detached)");
}

#[test]
fn test_parse_porcelain_locked() {
    let input = "\
worktree /home/user/repo
HEAD abc1234def
branch refs/heads/main

worktree /home/user/repo-wt
HEAD def5678abc
branch refs/heads/feature
locked

worktree /home/user/repo-wt2
HEAD ghi9012bcd
branch refs/heads/fix
locked in use by CI
";
    let result = parse_porcelain_output(input, "/home/user/repo").unwrap();
    assert_eq!(result.len(), 3);
    assert!(!result[0].is_locked);
    assert!(result[1].is_locked);
    assert_eq!(result[1].locked_reason, None);
    assert!(result[2].is_locked);
    assert_eq!(result[2].locked_reason, Some("in use by CI".to_string()));
}

#[test]
fn test_paths_equal() {
    #[cfg(windows)]
    {
        assert!(paths_equal("C:\\Git\\Repo", "c:\\git\\repo"));
        assert!(!paths_equal("C:\\Git\\Repo", "C:\\Git\\Other"));
    }
    #[cfg(not(windows))]
    {
        assert!(paths_equal("/home/user/repo", "/home/user/repo"));
        assert!(!paths_equal("/home/user/Repo", "/home/user/repo"));
    }
}

#[test]
fn test_disk_usage_cache_requires_invalidation_to_refresh() {
    let dir = tempdir().unwrap();
    let path = dir.path();
    let file = path.join("trace.log");

    fs::write(&file, vec![0_u8; 4]).unwrap();
    invalidate_disk_usage_cache(path);

    let first = disk_usage_bytes(path).unwrap();
    assert_eq!(first, 4);

    fs::write(&file, vec![0_u8; 9]).unwrap();

    let cached = disk_usage_bytes(path).unwrap();
    assert_eq!(cached, 4);

    invalidate_disk_usage_cache(path);
    let refreshed = disk_usage_bytes(path).unwrap();
    assert_eq!(refreshed, 9);
}
