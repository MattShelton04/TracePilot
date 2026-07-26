export const SESSION_PREFETCH_CONCURRENCY = 2;

interface PrefetchableSession {
  id: string;
  turnCount?: number | null;
  updatedAt?: string | null;
}

/**
 * Prefetch the most recently updated non-empty sessions through a small worker pool.
 * Workers continue after individual failures because prefetch is best-effort.
 */
export async function prefetchRecentSessions(
  sessions: readonly PrefetchableSession[],
  limit: number,
  prefetch: (sessionId: string) => Promise<unknown>,
  concurrency = SESSION_PREFETCH_CONCURRENCY,
): Promise<void> {
  const boundedLimit = Math.max(0, Math.floor(limit));
  const recent = sessions
    .filter((session) => (session.turnCount ?? 0) > 0)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, boundedLimit);
  const workerCount = Math.min(recent.length, Math.max(1, Math.floor(concurrency)));
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < recent.length) {
      const session = recent[nextIndex];
      nextIndex += 1;
      try {
        await prefetch(session.id);
      } catch {
        // Best-effort prefetch must not prevent remaining recent sessions.
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
