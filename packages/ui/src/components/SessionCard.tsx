import React from "react";
import type { SessionListItem } from "@tracepilot/types";

export interface SessionCardProps {
  session: SessionListItem;
  onClick?: (sessionId: string) => void;
}

/** A card displaying session summary, repo, branch, and timestamps. */
export function SessionCard({ session, onClick }: SessionCardProps) {
  return (
    <div
      className="session-card"
      onClick={() => onClick?.(session.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick?.(session.id)}
    >
      <h3 className="session-card__title">
        {session.summary || "Untitled Session"}
      </h3>
      <div className="session-card__meta">
        {session.repository && (
          <span className="session-card__repo">{session.repository}</span>
        )}
        {session.branch && (
          <span className="session-card__branch">{session.branch}</span>
        )}
      </div>
      <div className="session-card__dates">
        {session.createdAt && (
          <time dateTime={session.createdAt}>
            {new Date(session.createdAt).toLocaleDateString()}
          </time>
        )}
      </div>
    </div>
  );
}
