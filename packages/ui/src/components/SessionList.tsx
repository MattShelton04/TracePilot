import React from "react";
import type { SessionListItem } from "@tracepilot/types";
import { SessionCard } from "./SessionCard";

export interface SessionListProps {
  sessions: SessionListItem[];
  onSelect?: (sessionId: string) => void;
}

/** Renders a list of session cards. */
export function SessionList({ sessions, onSelect }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="session-list--empty">
        <p>No sessions found.</p>
        <p className="session-list--empty__hint">
          Sessions appear after using GitHub Copilot CLI.
        </p>
      </div>
    );
  }

  return (
    <div className="session-list">
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} onClick={onSelect} />
      ))}
    </div>
  );
}
