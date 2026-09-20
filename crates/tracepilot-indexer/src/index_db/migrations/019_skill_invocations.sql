-- One row per skill invocation, derived from the reconstructed conversation
-- (see tracepilot_core::skill_invocations). Powers Skills analytics: which
-- installed skills are actually used, which used skills are not installed,
-- and what each use costs in injected context.
CREATE TABLE IF NOT EXISTS session_skill_invocations (
    session_id TEXT NOT NULL,
    -- Index of the source event in the session's event stream. Unique within
    -- a session, and the deep-link target for the Conversation tab.
    event_index INTEGER NOT NULL,
    -- Main-conversation turn, from the same state machine the Conversation
    -- tab uses.
    turn_index INTEGER NOT NULL,
    tool_call_id TEXT,
    timestamp TEXT,
    -- The name exactly as recorded, plus its case-folded identity key.
    skill_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    -- Recorded SKILL.md path, and the case-folded directory it lives in.
    -- Both NULL for SDK-provided skills, which record no path.
    skill_path TEXT,
    normalized_directory TEXT,
    description TEXT,
    -- event.source, e.g. "project" | "personal-copilot" (CLI 1.0.49+).
    source TEXT,
    -- "user-invoked" | "agent-invoked" (CLI 1.0.49+); NULL means the CLI did
    -- not record it, which is reported as unknown rather than split.
    trigger TEXT,
    -- Runtime agent instance; NULL for the main agent.
    agent_id TEXT,
    agent_name TEXT,
    model TEXT,
    plugin_name TEXT,
    plugin_version TEXT,
    -- Fingerprint of the invoked content, for drift against the installed
    -- file. NULL for fallback rows.
    content_sha256 TEXT,
    -- Estimated tokens: the frontmatter is the per-turn listing cost, the
    -- pair is what this invocation injected.
    frontmatter_tokens INTEGER,
    instruction_tokens INTEGER,
    -- "event" | "tool_call_fallback" (a skill tool call with no event).
    origin TEXT NOT NULL,
    PRIMARY KEY (session_id, event_index),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_skill_invocations_name_ts
    ON session_skill_invocations(normalized_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_skill_invocations_ts
    ON session_skill_invocations(timestamp);
