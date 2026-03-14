import React, { useEffect, useState } from "react";
import { listSessions } from "@tracepilot/client";
import { SessionList } from "@tracepilot/ui";
import type { SessionListItem } from "@tracepilot/types";

function App() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <h1>TracePilot</h1>
        <p className="app__subtitle">Copilot CLI Session Explorer</p>
      </header>

      <main className="app__main">
        {loading && <p>Loading sessions...</p>}
        {error && <p className="app__error">Error: {error}</p>}
        {!loading && !error && (
          <SessionList sessions={sessions} onSelect={setSelectedId} />
        )}
        {selectedId && (
          <aside className="app__detail">
            <h2>Session: {selectedId}</h2>
            <p>Detail view coming soon...</p>
          </aside>
        )}
      </main>
    </div>
  );
}

export default App;
