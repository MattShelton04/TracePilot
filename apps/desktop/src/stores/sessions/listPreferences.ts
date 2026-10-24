import { SESSION_SOURCES, type SessionListItem, type SessionSource } from "@tracepilot/types";
import { usePersistedRef } from "@tracepilot/ui";
import { type Ref, ref, watch } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import type { SortOption } from "./filtering";

/** The session list's sort and filters, kept across restarts (not the search text). */
export interface SessionListPreferences {
  sortBy: SortOption;
  repo: string | null;
  source: SessionSource | null;
}

const SORT_OPTIONS: readonly SortOption[] = ["updated", "created", "oldest", "events", "turns"];

/** Keep each stored choice that is still valid; default the rest. */
export function readSessionListPreferences(raw: string): SessionListPreferences {
  const stored = JSON.parse(raw) as Record<string, unknown> | null;
  return {
    sortBy: SORT_OPTIONS.find((s) => s === stored?.sortBy) ?? "updated",
    repo: typeof stored?.repo === "string" && stored.repo ? stored.repo : null,
    source: SESSION_SOURCES.find((s) => s === stored?.source) ?? null,
  };
}

/**
 * The session list's sort and filter refs, restored from storage and written
 * back on every change. When a repository or source was restored,
 * `dropMissing` runs once the session list is first known (before it loads,
 * every repository would look missing), so the store can drop a filter the
 * list no longer has instead of showing an empty list.
 */
export function usePersistedSessionListPreferences(
  sessions: Ref<readonly SessionListItem[]>,
  dropMissing: () => void,
) {
  const stored = usePersistedRef<SessionListPreferences>(
    STORAGE_KEYS.sessionListPreferences,
    { sortBy: "updated", repo: null, source: null },
    { serializer: { read: readSessionListPreferences, write: (value) => JSON.stringify(value) } },
  );
  const initial = stored.value;
  const sortBy = ref<SortOption>(initial.sortBy);
  const filterRepo = ref<string | null>(initial.repo);
  const filterSource = ref<SessionSource | null>(initial.source);

  watch([sortBy, filterRepo, filterSource], ([sort, repo, source]) => {
    stored.value = { sortBy: sort, repo, source };
  });

  if (filterRepo.value !== null || filterSource.value !== null) {
    // Sync, so the first list never renders filtered by a stale choice.
    watch(sessions, dropMissing, { once: true, flush: "sync" });
  }

  return { sortBy, filterRepo, filterSource };
}
