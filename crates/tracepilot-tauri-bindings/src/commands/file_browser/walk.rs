//! Bounded, breadth-first listing of the session file browser's directories.
//!
//! Breadth-first so a capped listing keeps every shallow file and folder and
//! drops the deepest ones: an agent's scratchpad can hold a build folder
//! with tens of thousands of files, which a depth-first walk would let
//! crowd out everything listed after it.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};

use super::types::{
    MAX_DEPTH, MAX_ENTRIES, MAX_ENTRIES_PER_DIR, SessionFileEntry, SessionFileType,
};

/// A directory to list: its canonical path, the relative path its entries
/// start with (empty for the tree's root), and its depth in the tree.
pub(super) struct WalkRoot {
    pub dir: PathBuf,
    pub prefix: String,
    pub depth: usize,
}

/// Collect the entries under `roots`, breadth-first across all of them,
/// with paths relative to the tree's root and forward slashes.
///
/// Skips dotfiles (e.g. `.git`) and every symlink, and never descends into a
/// directory whose canonical path leaves its walk root. Stops at
/// [`MAX_ENTRIES`] in total and [`MAX_ENTRIES_PER_DIR`] per directory, and
/// does not read directories deeper than [`MAX_DEPTH`]. A directory that
/// cannot be read (Claude Code's cleanup may delete it mid-walk) is skipped.
///
/// Returns whether anything was left out.
pub(super) fn collect_entries(roots: Vec<WalkRoot>, entries: &mut Vec<SessionFileEntry>) -> bool {
    let mut queue: VecDeque<(PathBuf, String, usize, usize)> = VecDeque::new();
    for (index, root) in roots.iter().enumerate() {
        queue.push_back((root.dir.clone(), root.prefix.clone(), root.depth, index));
    }
    let mut truncated = false;

    while let Some((dir, prefix, depth, root_index)) = queue.pop_front() {
        if depth > MAX_DEPTH {
            truncated = true;
            continue;
        }
        let Ok(read_dir) = std::fs::read_dir(&dir) else {
            continue;
        };
        let walk_root = &roots[root_index].dir;
        let mut listed_here = 0;
        for entry in read_dir.flatten() {
            if entries.len() >= MAX_ENTRIES || listed_here >= MAX_ENTRIES_PER_DIR {
                truncated = true;
                break;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            // `DirEntry::file_type` does not follow symlinks, so a link to a
            // directory is a symlink here. Skipping every link prevents both
            // traversal out of the tree and link cycles.
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let path = entry.path();
            if file_type.is_dir() {
                // TOCTOU mitigation: canonicalize before queueing. The
                // directory could be swapped for a link (for example by an
                // agent writing to its own scratchpad) between the type
                // check and the read; its canonical path then leaves the
                // walk root and it is skipped.
                let Some(canonical) = canonical_within(&path, walk_root) else {
                    continue;
                };
                entries.push(SessionFileEntry {
                    path: relative.clone(),
                    name,
                    size_bytes: 0,
                    is_directory: true,
                    file_type: SessionFileType::Binary, // unused for dirs
                });
                queue.push_back((canonical, relative, depth + 1, root_index));
            } else {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                entries.push(SessionFileEntry {
                    file_type: SessionFileType::from_name(&name),
                    path: relative,
                    name,
                    size_bytes: size,
                    is_directory: false,
                });
            }
            listed_here += 1;
        }
    }
    truncated
}

/// Whether `dir` holds at least one visible file, looking breadth-first
/// through at most [`MAX_ENTRIES`] entries. Claude Code's cleanup deletes a
/// scratchpad's files but leaves its folders, so an empty skeleton is not
/// worth showing. Links are never followed.
pub(super) fn has_visible_files(dir: &Path) -> bool {
    let mut queue = VecDeque::from([(dir.to_path_buf(), 0)]);
    let mut seen = 0;
    while let Some((dir, depth)) = queue.pop_front() {
        let Ok(read_dir) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            seen += 1;
            if seen > MAX_ENTRIES {
                return false;
            }
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            match entry.file_type() {
                Ok(t) if t.is_file() => return true,
                Ok(t) if t.is_dir() && depth < MAX_DEPTH => {
                    queue.push_back((entry.path(), depth + 1));
                }
                _ => {}
            }
        }
    }
    false
}

fn canonical_within(path: &Path, root: &Path) -> Option<PathBuf> {
    let canonical = path.canonicalize().ok()?;
    canonical.starts_with(root).then_some(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// A canonical session directory: subdirectory prefix checks compare
    /// canonical paths on every platform.
    fn make_session_dir(tmp: &TempDir) -> PathBuf {
        let dir = tmp.path().join("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn walk(dir: &Path) -> (Vec<SessionFileEntry>, bool) {
        let mut entries = Vec::new();
        let truncated = collect_entries(
            vec![WalkRoot {
                dir: dir.to_path_buf(),
                prefix: String::new(),
                depth: 0,
            }],
            &mut entries,
        );
        (entries, truncated)
    }

    fn paths(entries: &[SessionFileEntry]) -> Vec<&str> {
        entries.iter().map(|e| e.path.as_str()).collect()
    }

    #[test]
    fn lists_files_and_folders_with_forward_slashes() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        std::fs::write(session_dir.join("events.jsonl"), "{}\n").unwrap();
        std::fs::create_dir_all(session_dir.join("files")).unwrap();
        std::fs::write(session_dir.join("files").join("plan.md"), "# Plan").unwrap();

        let (entries, truncated) = walk(&session_dir);
        let mut listed = paths(&entries);
        listed.sort_unstable();
        assert_eq!(listed, ["events.jsonl", "files", "files/plan.md"]);
        assert!(!truncated);
        let plan = entries.iter().find(|e| e.name == "plan.md").unwrap();
        assert_eq!((plan.size_bytes, plan.is_directory), (6, false));
    }

    #[test]
    fn skips_hidden_files_and_folders() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        std::fs::write(session_dir.join(".hidden"), "secret").unwrap();
        std::fs::create_dir_all(session_dir.join(".git")).unwrap();
        std::fs::write(session_dir.join(".git").join("HEAD"), "ref").unwrap();
        std::fs::write(session_dir.join("visible.txt"), "public").unwrap();

        assert_eq!(paths(&walk(&session_dir).0), ["visible.txt"]);
    }

    #[test]
    fn the_total_cap_drops_the_deepest_entries_first() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        // A huge build folder listed first must not hide a later sibling.
        let build = session_dir.join("aaa-build");
        let per_dir = MAX_ENTRIES_PER_DIR - 1;
        for d in 0..MAX_ENTRIES.div_ceil(per_dir) {
            let deps = build.join(format!("deps-{d}"));
            std::fs::create_dir_all(&deps).unwrap();
            for i in 0..per_dir {
                std::fs::write(deps.join(format!("obj_{i}.o")), "x").unwrap();
            }
        }
        std::fs::write(session_dir.join("zzz-report.md"), "# Report").unwrap();

        let (entries, truncated) = walk(&session_dir);
        assert!(truncated);
        assert_eq!(entries.len(), MAX_ENTRIES);
        let listed = paths(&entries);
        for shallow in ["aaa-build", "aaa-build/deps-0", "zzz-report.md"] {
            assert!(listed.contains(&shallow), "{shallow} missing");
        }
    }

    #[test]
    fn one_crowded_folder_cannot_take_the_whole_budget() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        let shots = session_dir.join("aaa-shots");
        let notes = session_dir.join("bbb-notes");
        std::fs::create_dir_all(&shots).unwrap();
        std::fs::create_dir_all(&notes).unwrap();
        for i in 0..MAX_ENTRIES_PER_DIR + 10 {
            std::fs::write(shots.join(format!("shot_{i}.png")), "x").unwrap();
        }
        std::fs::write(notes.join("notes.md"), "# Notes").unwrap();

        let (entries, truncated) = walk(&session_dir);
        assert!(truncated);
        let in_shots = entries
            .iter()
            .filter(|e| e.path.starts_with("aaa-shots/"))
            .count();
        assert_eq!(in_shots, MAX_ENTRIES_PER_DIR);
        assert!(paths(&entries).contains(&"bbb-notes/notes.md"));
    }

    #[test]
    fn folders_beyond_the_depth_cap_are_not_read() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        let mut deep = session_dir.clone();
        for _ in 0..=MAX_DEPTH {
            deep = deep.join("sub");
            std::fs::create_dir_all(&deep).unwrap();
        }
        std::fs::write(deep.join("deep.txt"), "too deep").unwrap();

        let (entries, truncated) = walk(&session_dir);
        assert!(truncated);
        assert!(!entries.iter().any(|e| e.name == "deep.txt"));
    }

    #[test]
    fn several_roots_are_listed_under_their_prefixes() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        let other = tmp.path().join("elsewhere").join("scratchpad");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(session_dir.join("a.txt"), "a").unwrap();
        std::fs::write(other.join("b.png"), "b").unwrap();

        let mut entries = Vec::new();
        let truncated = collect_entries(
            vec![
                WalkRoot {
                    dir: session_dir.clone(),
                    prefix: "subagents".into(),
                    depth: 1,
                },
                WalkRoot {
                    dir: other.canonicalize().unwrap(),
                    prefix: "scratchpad".into(),
                    depth: 1,
                },
            ],
            &mut entries,
        );
        assert!(!truncated);
        assert_eq!(paths(&entries), ["subagents/a.txt", "scratchpad/b.png"]);
    }

    #[test]
    fn an_empty_folder_skeleton_has_no_visible_files() {
        let tmp = TempDir::new().unwrap();
        let dir = make_session_dir(&tmp);
        std::fs::create_dir_all(dir.join("spike").join(".git").join("objects")).unwrap();
        std::fs::write(dir.join("spike").join(".git").join("HEAD"), "ref").unwrap();
        std::fs::write(dir.join(".hidden"), "x").unwrap();
        assert!(!has_visible_files(&dir));
        assert!(!has_visible_files(&tmp.path().join("gone")));

        std::fs::write(dir.join("spike").join("notes.md"), "# Notes").unwrap();
        assert!(has_visible_files(&dir));
    }

    #[test]
    fn a_missing_root_lists_nothing() {
        let tmp = TempDir::new().unwrap();
        let (entries, truncated) = walk(&tmp.path().join("gone"));
        assert!(entries.is_empty());
        assert!(!truncated);
    }

    /// Regression test for the TOCTOU symlink race. Windows symlinks need
    /// elevation, so this runs on Unix only.
    #[test]
    #[cfg(unix)]
    fn skips_a_symlinked_folder_outside_the_root() {
        use std::os::unix::fs::symlink;

        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        let outside_dir = tmp.path().join("outside");
        std::fs::create_dir_all(&outside_dir).unwrap();
        std::fs::write(outside_dir.join("secret.txt"), "secret").unwrap();
        symlink(&outside_dir, session_dir.join("evil_link")).unwrap();

        let (entries, _) = walk(&session_dir);
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(!names.contains(&"evil_link"), "{names:?}");
        assert!(!names.contains(&"secret.txt"), "{names:?}");
    }
}
