-- The GitHub pull requests each session is linked to, from
-- tracepilot_core::pull_requests. Existing rows fill in when sessions reindex
-- (analytics versions 22 and Claude Code 34).

-- One row per (session, pull request), rebuilt with the session.
CREATE TABLE IF NOT EXISTS session_pull_requests (
    session_id TEXT NOT NULL,
    host TEXT NOT NULL,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    number INTEGER NOT NULL,
    -- PullRequestRoles bits: created 1, updated 2, merged 4, reviewed 8, mentioned 16.
    roles INTEGER NOT NULL,
    -- PullRequestEvidenceSet bits (diagnostics only).
    evidence INTEGER NOT NULL,
    -- The one pull request that stands for the session in the list and header.
    is_primary INTEGER NOT NULL DEFAULT 0,
    head_ref TEXT,
    base_ref TEXT,
    title TEXT,
    first_seen_at TEXT,
    last_seen_at TEXT,
    -- The event that established the strongest role.
    event_index INTEGER,
    PRIMARY KEY (session_id, host, owner, repo, number),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
-- Sessions linked to one pull request.
CREATE INDEX IF NOT EXISTS idx_session_pull_requests_pr
    ON session_pull_requests(owner COLLATE NOCASE, repo COLLATE NOCASE, number);

-- Branches each session pushed to a GitHub remote, rebuilt with the session.
CREATE TABLE IF NOT EXISTS session_pushed_branches (
    session_id TEXT NOT NULL,
    host TEXT NOT NULL,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    branch TEXT NOT NULL,
    first_push_at TEXT,
    last_push_at TEXT,
    push_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (session_id, host, owner, repo, branch),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Pull requests found on GitHub for a pushed branch. Looked up over the
-- network, so a reindex keeps them; rows go with their session.
CREATE TABLE IF NOT EXISTS session_branch_pull_requests (
    session_id TEXT NOT NULL,
    host TEXT NOT NULL,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    branch TEXT NOT NULL,
    number INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (session_id, host, owner, repo, branch, number),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Last known state of each pull request on GitHub, shared by every session
-- linked to it. Looked up over the network; a reindex keeps it.
CREATE TABLE IF NOT EXISTS pull_request_status (
    host TEXT NOT NULL COLLATE NOCASE,
    owner TEXT NOT NULL COLLATE NOCASE,
    repo TEXT NOT NULL COLLATE NOCASE,
    number INTEGER NOT NULL,
    -- open | closed | merged
    state TEXT,
    is_draft INTEGER,
    title TEXT,
    head_ref TEXT,
    base_ref TEXT,
    head_owner TEXT,
    created_at TEXT,
    merged_at TEXT,
    closed_at TEXT,
    -- approved | changes_requested | review_required
    review_decision TEXT,
    -- success | failure | pending | error | expected
    checks_state TEXT,
    fetched_at TEXT NOT NULL,
    -- The last lookup's failure, when it failed.
    error TEXT,
    PRIMARY KEY (host, owner, repo, number)
);

-- The session's primary pull request and how many it links, for the list.
ALTER TABLE sessions ADD COLUMN linked_pr_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN primary_pr_host TEXT;
ALTER TABLE sessions ADD COLUMN primary_pr_owner TEXT;
ALTER TABLE sessions ADD COLUMN primary_pr_repo TEXT;
ALTER TABLE sessions ADD COLUMN primary_pr_number INTEGER;
