//! The session list's repository filter, resolved against the index.
//!
//! The session list (`apps/desktop/src/stores/sessions/filtering.ts`) files a
//! session under its repository, or under `project:<folder name>` when it
//! records only a working directory. A repository-less session whose folder
//! is exactly one where sessions of a single repository ran also belongs to
//! that repository (`repositoryFolders.ts`), which is how Claude Code sessions
//! (often cwd-only) reach their repository. Analytics and Search receive the
//! same filter values, so they resolve them here into the repositories and
//! the exact `cwd` strings of the repository-less sessions they cover, and
//! select the same sessions as the list. Per-repository figures attribute
//! each session by the same folder rule through [`FolderRepositories`].

use std::collections::{BTreeSet, HashMap};

use rusqlite::Connection;

use crate::Result;

/// Marks a filter value as a folder-only project (`PROJECT_FILTER_PREFIX`).
const PROJECT_PREFIX: &str = "project:";

/// Sessions selected by one or more repository-filter values.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(in crate::index_db) struct RepositoryScope {
    /// Matched by `sessions.repository`.
    repositories: BTreeSet<String>,
    /// Exact `cwd` values of repository-less sessions in scope.
    folders: BTreeSet<String>,
}

/// A repository-less session's `(cwd, folder key, folder name)`.
type LooseFolder = (String, Option<String>, Option<String>);

impl RepositoryScope {
    /// Repositories with no folder-only sessions, for SQL-shape tests.
    #[cfg(test)]
    pub(in crate::index_db) fn of_repositories<S: AsRef<str>>(names: &[S]) -> Self {
        Self {
            repositories: names.iter().map(|n| n.as_ref().to_string()).collect(),
            folders: BTreeSet::new(),
        }
    }

    /// Resolve filter values. `None` when there are none, so unfiltered
    /// queries keep their SQL. With `folder_fallback`, a plain value naming no
    /// repository selects the folder of that name, as `repo:<folder>` typed
    /// into Search means.
    pub(in crate::index_db) fn resolve<S: AsRef<str>>(
        conn: &Connection,
        keys: &[S],
        folder_fallback: bool,
    ) -> Result<Option<Self>> {
        if keys.is_empty() {
            return Ok(None);
        }
        let rows = session_folders(conn)?;
        let folder_repos = FolderRepositories::from_rows(&rows);
        let mut known_repos = BTreeSet::new();
        let mut loose: Vec<LooseFolder> = Vec::new();
        for (repository, cwd) in rows {
            match repository {
                Some(repo) => {
                    known_repos.insert(repo);
                }
                None => {
                    if let Some(cwd) = cwd {
                        let key = folder_key(Some(&cwd));
                        let label = project_label(&cwd).map(str::to_string);
                        loose.push((cwd, key, label));
                    }
                }
            }
        }

        let mut scope = Self::default();
        for key in keys {
            let key = key.as_ref();
            let label = match key.strip_prefix(PROJECT_PREFIX) {
                Some(label) => Some(label),
                None if folder_fallback && !known_repos.contains(key) => Some(key),
                None => None,
            };
            if label.is_none() {
                scope.repositories.insert(key.to_string());
            }
            for (cwd, folder, name) in &loose {
                let folded = label.is_none()
                    && folder.as_deref().and_then(|f| folder_repos.by_key(f)) == Some(key);
                if folded || (label.is_some() && name.as_deref() == label) {
                    scope.folders.insert(cwd.clone());
                }
            }
        }
        Ok(Some(scope))
    }

    /// The condition over the `sessions s` alias, with its bind values.
    pub(in crate::index_db) fn condition(&self) -> (String, Vec<String>) {
        let mut parts = Vec::new();
        let mut values = Vec::new();
        match self.repositories.len() {
            0 => {}
            1 => parts.push("s.repository = ?".to_string()),
            n => parts.push(format!("s.repository IN ({})", vec!["?"; n].join(", "))),
        }
        values.extend(self.repositories.iter().cloned());
        if !self.folders.is_empty() {
            parts.push(
                "(COALESCE(s.repository, '') = '' \
                 AND s.cwd IN (SELECT value FROM json_each(?)))"
                    .to_string(),
            );
            let folders: Vec<&String> = self.folders.iter().collect();
            values.push(serde_json::to_string(&folders).unwrap_or_else(|_| "[]".into()));
        }
        if parts.is_empty() {
            return ("0".to_string(), values);
        }
        (format!("({})", parts.join(" OR ")), values)
    }

    /// Append ` AND <condition>` to a WHERE clause.
    pub(in crate::index_db) fn append_to(&self, clause: &mut String, values: &mut Vec<String>) {
        let (condition, mut binds) = self.condition();
        clause.push_str(" AND ");
        clause.push_str(&condition);
        values.append(&mut binds);
    }
}

/// Each session's distinct `(repository, cwd)`, a blank repository read as none.
fn session_folders(conn: &Connection) -> Result<Vec<(Option<String>, Option<String>)>> {
    let mut stmt = conn.prepare("SELECT DISTINCT repository, cwd FROM sessions")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?.filter(|r| !r.is_empty()),
                row.get::<_, Option<String>>(1)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// The folder rule of [`RepositoryScope`] as an attribution: a
/// repository-less session in a folder where sessions of exactly one
/// repository ran belongs to that repository, as on the session list.
#[derive(Debug)]
pub(in crate::index_db) struct FolderRepositories {
    /// Folder key → its one repository, or `None` when sessions there name more.
    by_folder: HashMap<String, Option<String>>,
}

impl FolderRepositories {
    pub(in crate::index_db) fn load(conn: &Connection) -> Result<Self> {
        Ok(Self::from_rows(&session_folders(conn)?))
    }

    fn from_rows(rows: &[(Option<String>, Option<String>)]) -> Self {
        let mut by_folder: HashMap<String, Option<String>> = HashMap::new();
        for (repository, cwd) in rows {
            let (Some(repo), Some(key)) = (repository, folder_key(cwd.as_deref())) else {
                continue;
            };
            by_folder
                .entry(key)
                .and_modify(|known| {
                    if known.as_deref() != Some(repo.as_str()) {
                        *known = None;
                    }
                })
                .or_insert_with(|| Some(repo.clone()));
        }
        Self { by_folder }
    }

    /// The one repository of a folder key, if exactly one ran there.
    fn by_key(&self, key: &str) -> Option<&str> {
        self.by_folder.get(key).and_then(Option::as_deref)
    }

    /// The repository a session counts under: its own when it records one,
    /// otherwise its folder's single repository, otherwise none.
    pub(in crate::index_db) fn attribute(
        &self,
        repository: Option<String>,
        cwd: Option<&str>,
    ) -> Option<String> {
        repository.filter(|r| !r.is_empty()).or_else(|| {
            folder_key(cwd)
                .and_then(|key| self.by_key(&key))
                .map(str::to_string)
        })
    }
}

/// `folderKey` from `repositoryFolders.ts`: separators unified, repeated and
/// trailing ones dropped, the `\\?\` prefix removed, and Windows paths (drive
/// letter or UNC) case-folded. POSIX paths keep their case.
pub(in crate::index_db) fn folder_key(cwd: Option<&str>) -> Option<String> {
    let mut path = cwd?.trim().replace('\\', "/");
    if path.is_empty() {
        return None;
    }
    if let Some(rest) = path.strip_prefix("//?/UNC/") {
        path = format!("//{rest}");
    } else if let Some(rest) = path.strip_prefix("//?/") {
        path = rest.to_string();
    }
    let unc = path.starts_with("//");
    let mut collapsed = String::with_capacity(path.len());
    for ch in path.chars() {
        if ch == '/' && collapsed.ends_with('/') {
            continue;
        }
        collapsed.push(ch);
    }
    let mut path = collapsed.trim_end_matches('/').to_string();
    if unc {
        path.insert(0, '/');
    }
    if path.is_empty() || is_drive(&path) {
        path.push('/');
    }
    let bytes = path.as_bytes();
    let windows = path.starts_with("//")
        || (is_drive(path.get(..2).unwrap_or("")) && bytes.get(2) == Some(&b'/'));
    Some(if windows { path.to_lowercase() } else { path })
}

/// `C:` exactly.
fn is_drive(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// `projectLabelFromCwd` from `@tracepilot/ui`: the last path segment, or the
/// trimmed path itself for a root such as `/`.
pub(in crate::index_db) fn project_label(cwd: &str) -> Option<&str> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return None;
    }
    let is_sep = |c: char| c == '/' || c == '\\';
    let without_trailing = trimmed.trim_end_matches(is_sep);
    let start = without_trailing.rfind(is_sep).map_or(0, |i| i + 1);
    let label = &without_trailing[start..];
    Some(if label.is_empty() { trimmed } else { label })
}

#[cfg(test)]
mod tests {
    use super::{folder_key, project_label};

    /// The cases `repositoryFolders.test.ts` pins for `folderKey`.
    #[test]
    fn folder_key_matches_the_session_list() {
        let key = |p: &str| folder_key(Some(p));
        assert_eq!(
            key("C:/synthetic/orchard").as_deref(),
            Some("c:/synthetic/orchard")
        );
        assert_eq!(
            key(r" C:\Synthetic\Orchard\ ").as_deref(),
            Some("c:/synthetic/orchard")
        );
        assert_eq!(
            key(r"\\?\C:\Synthetic\Orchard").as_deref(),
            Some("c:/synthetic/orchard")
        );
        assert_eq!(
            key(r"\\?\UNC\Server\Share").as_deref(),
            Some("//server/share")
        );
        assert_eq!(
            key(r"\\Server\Share\Repo\").as_deref(),
            Some("//server/share/repo")
        );
        assert_eq!(
            key("/home/dev/Orchard//").as_deref(),
            Some("/home/dev/Orchard")
        );
        assert_ne!(key("/home/dev/orchard"), key("/home/dev/Orchard"));
        assert_eq!(key("/").as_deref(), Some("/"));
        assert_eq!(key(r"C:\").as_deref(), Some("c:/"));
        assert_eq!(key("C:").as_deref(), Some("c:/"));
        assert_eq!(key("  "), None);
        assert_eq!(folder_key(None), None);
    }

    /// The cases `pathUtils.test.ts` pins for `projectLabelFromCwd`.
    #[test]
    fn project_label_matches_the_session_list() {
        assert_eq!(project_label(r"C:\work\orchard\"), Some("orchard"));
        assert_eq!(project_label("/home/dev/lantern"), Some("lantern"));
        assert_eq!(project_label("/"), Some("/"));
        assert_eq!(project_label(r"C:\"), Some("C:"));
        assert_eq!(project_label("  "), None);
        assert_eq!(
            project_label(&format!("a{}b", "/".repeat(50_000))),
            Some("b")
        );
    }
}
