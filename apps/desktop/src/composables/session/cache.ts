/**
 * Small LRU cache keyed by session id used by useSessionDetail for
 * instant-restore on session switch. Extracted from useSessionDetail to
 * isolate the Map-based LRU logic.
 */
import type {
  CheckpointEntry,
  ConversationTurn,
  SessionDetail,
  SessionIncident,
  SessionPlan,
  ShutdownMetrics,
} from "@tracepilot/types";
import type { EventsFingerprint } from "./sessionFingerprint";

export interface CachedSession {
  detail: SessionDetail;
  turns: ConversationTurn[];
  eventsFingerprint: EventsFingerprint;
  checkpoints: CheckpointEntry[];
  plan: SessionPlan | null;
  shutdownMetrics: ShutdownMetrics | null;
  incidents: SessionIncident[];
  loadedSections: Set<string>;
}

export const DEFAULT_SESSION_CACHE_SIZE = 10;

export interface SessionCache {
  set(id: string, cached: CachedSession): void;
  get(id: string): CachedSession | undefined;
  has(id: string): boolean;
  clear(): void;
  readonly size: number;
}

/**
 * Creates an LRU-bounded session cache. Most-recently set/accessed entries
 * stay; once `maxSize` is exceeded the least-recently-used entry is evicted.
 */
export function createSessionCache(
  maxSize: number = DEFAULT_SESSION_CACHE_SIZE,
): SessionCache {
  const map = new Map<string, CachedSession>();

  return {
    set(id, cached) {
      map.delete(id);
      map.set(id, cached);
      if (map.size > maxSize) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
    },
    get(id) {
      const entry = map.get(id);
      if (entry !== undefined) {
        // refresh recency
        map.delete(id);
        map.set(id, entry);
      }
      return entry;
    },
    has(id) {
      return map.has(id);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}
