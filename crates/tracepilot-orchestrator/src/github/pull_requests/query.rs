//! Input validation and the `gh api graphql` argument vectors.
//!
//! The query text is built only from aliases (`pr0`, `b0`) and variable names
//! (`$o0`); every value travels as a variable.

/// GraphQL aliases per `gh` call. One call costs one rate-limit point.
pub const MAX_ALIASES_PER_CALL: usize = 50;

/// Highest pull request number we ever send.
const MAX_NUMBER: u32 = 999_999_999;
/// Longest branch name we send, in bytes.
const MAX_BRANCH_BYTES: usize = 255;

const PR_FIELDS: &str = "fragment PrFields on PullRequest { number title state isDraft \
mergedAt closedAt createdAt headRefName baseRefName headRepositoryOwner { login } \
reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }";

/// A host name: `github.com`, a `*.ghe.com` tenant or another plain DNS name.
pub fn valid_host(host: &str) -> bool {
    (1..=253).contains(&host.len())
        && host.split('.').all(|label| {
            (1..=63).contains(&label.len())
                && !label.starts_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

/// A GitHub user or organisation name.
pub fn valid_owner(owner: &str) -> bool {
    (1..=39).contains(&owner.len())
        && !owner.starts_with('-')
        && owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// A GitHub repository name.
pub fn valid_repo(repo: &str) -> bool {
    (1..=100).contains(&repo.len())
        && repo != "."
        && repo != ".."
        && repo
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// A pull request number.
pub fn valid_number(number: u32) -> bool {
    (1..=MAX_NUMBER).contains(&number)
}

/// A branch name: non-empty, at most 255 bytes, no control characters.
pub fn valid_branch(branch: &str) -> bool {
    !branch.is_empty() && branch.len() <= MAX_BRANCH_BYTES && !branch.chars().any(char::is_control)
}

/// One pull request to look up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestQuery {
    pub owner: String,
    pub repo: String,
    pub number: u32,
}

impl PullRequestQuery {
    pub fn is_valid(&self) -> bool {
        valid_owner(&self.owner) && valid_repo(&self.repo) && valid_number(self.number)
    }
}

/// One pushed branch to find pull requests for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchQuery {
    pub owner: String,
    pub repo: String,
    pub branch: String,
}

impl BranchQuery {
    pub fn is_valid(&self) -> bool {
        valid_owner(&self.owner) && valid_repo(&self.repo) && valid_branch(&self.branch)
    }
}

fn base_args(host: &str, query: String) -> Vec<String> {
    vec![
        "api".into(),
        "graphql".into(),
        "--hostname".into(),
        host.to_string(),
        "-f".into(),
        format!("query={query}"),
    ]
}

/// A raw-string variable: `-f` never reads a leading `@` as a file.
fn push_string(args: &mut Vec<String>, name: String, value: &str) {
    args.push("-f".into());
    args.push(format!("{name}={value}"));
}

/// `gh api graphql` arguments for a batch of pull request lookups, aliased
/// `pr0`, `pr1`, … in order. Callers pass validated queries.
pub(super) fn status_args(host: &str, queries: &[&PullRequestQuery]) -> Vec<String> {
    let mut declarations = Vec::with_capacity(queries.len() * 3);
    let mut selections = Vec::with_capacity(queries.len());
    for i in 0..queries.len() {
        declarations.push(format!("$o{i}: String!, $n{i}: String!, $p{i}: Int!"));
        selections.push(format!(
            "pr{i}: repository(owner: $o{i}, name: $n{i}) {{ pullRequest(number: $p{i}) {{ ...PrFields }} }}"
        ));
    }
    let query = format!(
        "query({}) {{ {} }} {PR_FIELDS}",
        declarations.join(", "),
        selections.join(" ")
    );
    let mut args = base_args(host, query);
    for (i, pr) in queries.iter().enumerate() {
        push_string(&mut args, format!("o{i}"), &pr.owner);
        push_string(&mut args, format!("n{i}"), &pr.repo);
        // A number we hold as a u32, never text from outside.
        args.push("-F".into());
        args.push(format!("p{i}={}", pr.number));
    }
    args
}

/// `gh api graphql` arguments for a batch of branch lookups, aliased `b0`,
/// `b1`, … in order. Callers pass validated queries.
pub(super) fn branch_args(host: &str, queries: &[&BranchQuery]) -> Vec<String> {
    let mut declarations = Vec::with_capacity(queries.len() * 3);
    let mut selections = Vec::with_capacity(queries.len());
    for i in 0..queries.len() {
        declarations.push(format!("$o{i}: String!, $n{i}: String!, $h{i}: String!"));
        selections.push(format!(
            "b{i}: repository(owner: $o{i}, name: $n{i}) {{ defaultBranchRef {{ name }} \
             pullRequests(headRefName: $h{i}, first: 5, states: [OPEN, MERGED, CLOSED], \
             orderBy: {{field: CREATED_AT, direction: DESC}}) {{ nodes {{ ...PrFields }} }} }}"
        ));
    }
    let query = format!(
        "query({}) {{ {} }} {PR_FIELDS}",
        declarations.join(", "),
        selections.join(" ")
    );
    let mut args = base_args(host, query);
    for (i, branch) in queries.iter().enumerate() {
        push_string(&mut args, format!("o{i}"), &branch.owner);
        push_string(&mut args, format!("n{i}"), &branch.repo);
        push_string(&mut args, format!("h{i}"), &branch.branch);
    }
    args
}
