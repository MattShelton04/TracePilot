-- User turns per model and reasoning effort, from
-- tracepilot_core::effort_usage. A user turn is every agent turn that serves
-- one typed user message. The request columns come from Copilot CLI's
-- session store and cover only `observed_user_turns`; the others come from
-- the session's events. Existing rows fill in when sessions reindex
-- (analytics version 17).
CREATE TABLE IF NOT EXISTS session_effort_usage (
    session_id TEXT NOT NULL,
    -- '' when unknown, so the primary key stays usable.
    model TEXT NOT NULL,
    -- '' when the model's default effort applied.
    reasoning_effort TEXT NOT NULL,
    user_turns INTEGER NOT NULL,
    agent_turns INTEGER NOT NULL,
    tool_calls INTEGER NOT NULL,
    wall_ms INTEGER NOT NULL,
    observed_user_turns INTEGER NOT NULL,
    requests INTEGER NOT NULL,
    reasoning_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    api_duration_ms INTEGER NOT NULL,
    total_nano_aiu INTEGER NOT NULL,
    subagent_requests INTEGER NOT NULL,
    subagent_nano_aiu INTEGER NOT NULL,
    PRIMARY KEY (session_id, model, reasoning_effort),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
