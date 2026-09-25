-- Inter-agent messaging per agent run (Copilot CLI 1.0.78+), from
-- tracepilot_core::agent_runs. Existing rows fill in when sessions reindex
-- (analytics version 15).
ALTER TABLE session_agent_runs ADD COLUMN messages_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_agent_runs ADD COLUMN messages_received INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_agent_runs ADD COLUMN peer_messages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_agent_runs ADD COLUMN queued_messages INTEGER NOT NULL DEFAULT 0;
