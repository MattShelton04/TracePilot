/**
 * The other sessions linked to each of a session's pull requests, for the
 * Overview's "Also in N other sessions" menus.
 *
 * Per open session: the counts load once for each set of pull requests the
 * session detail lists. A refresh that lists the same pull requests (every
 * poll of a running session) loads nothing; a different set reloads the
 * counts while the old ones stay on screen. One pull request's sessions load
 * only when its menu opens, and stay cached while that pull request is still
 * listed.
 *
 * Lifecycle (ADR 0006): state is keyed by session id, several open session
 * tabs at once, so one store-wide `runAction` loading/error pair or a single
 * `useAsyncGuard` would let one tab's load cancel another's. Instead each
 * session entry owns an `AsyncGuard` for its counts, and each menu list is
 * applied only while it is still the list cached for that pull request (a
 * retry or a reload replaces the object). Entries are evicted least recently
 * used; the Overview section loads an evicted session's counts again.
 *
 * An index pass can link other sessions to these pull requests, so when one
 * finishes every entry goes stale: `revision` moves, the mounted Overview asks
 * again, and the counts reload in the background with the old ones on screen.
 * A cached menu list loads again the next time its menu opens. A load that
 * fails leaves its entry stale, so the next ask tries again.
 */
import {
  getPullRequestSessions,
  getSessionPullRequestRelatedCounts,
  IPC_EVENTS,
} from "@tracepilot/client";
import type { PullRequestSessionLink, SessionPullRequest } from "@tracepilot/types";
import { type AsyncGuard, toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { markRaw, reactive, ref, toRaw } from "vue";
import { useScopedEventListener } from "@/composables/useScopedEventListener";
import { logWarn } from "@/utils/logger";

export interface PullRequestKeyParts {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

/** `host/owner/repo#n`, lower-cased: owner and repo match case-insensitively. */
export function pullRequestKey(pr: PullRequestKeyParts): string {
  return `${pr.host}/${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();
}

/** The set of pull requests a list names, whatever their order or other fields. */
export function pullRequestSignature(prs: readonly PullRequestKeyParts[]): string {
  return [...new Set(prs.map(pullRequestKey))].sort().join("\n");
}

export interface RelatedSessionsState {
  status: "loading" | "ready" | "error";
  /** The other sessions; the current one is left out. */
  sessions: PullRequestSessionLink[];
  error: string | null;
}

interface SessionEntry {
  /** `pullRequestSignature` of the list the counts are (being) loaded for. */
  signature: string;
  /** Other-session counts by `pullRequestKey`; null until they first load. */
  counts: Map<string, number> | null;
  /** Set by an index pass or a failed load: the next load runs even for the same set. */
  stale: boolean;
  lists: Map<string, RelatedSessionsState>;
  guard: AsyncGuard;
}

/** Sessions remembered at once: more than the tab strip holds plus the routed view. */
const MAX_SESSIONS = 32;

export const usePullRequestSessionsStore = defineStore("pullRequestSessions", () => {
  const entries = reactive(new Map<string, SessionEntry>());
  /** Last use of each entry, for eviction; not reactive, so reads may touch it. */
  const lastUsed = new Map<string, number>();
  let clock = 0;
  /** Menu lists an index pass may have outdated; not reactive, read only by loads. */
  const staleLists = new WeakSet<RelatedSessionsState>();
  /** Moves when an index pass finishes, for the Overview to ask again. */
  const revision = ref(0);

  function touch(sessionId: string) {
    lastUsed.set(sessionId, ++clock);
  }

  function remove(sessionId: string) {
    entries.delete(sessionId);
    lastUsed.delete(sessionId);
  }

  function evict(keep: string) {
    while (entries.size > MAX_SESSIONS) {
      let oldest: string | null = null;
      let oldestUse = Number.POSITIVE_INFINITY;
      for (const id of entries.keys()) {
        const use = lastUsed.get(id) ?? 0;
        if (id !== keep && use < oldestUse) {
          oldest = id;
          oldestUse = use;
        }
      }
      if (oldest === null) return;
      remove(oldest);
    }
  }

  /** Whether `sessionId` has counts loaded or loading. */
  function hasEntry(sessionId: string): boolean {
    return entries.has(sessionId);
  }

  /**
   * Load the counts for `pullRequests`, the session's list as its detail
   * loaded it. The same set of pull requests loads nothing again unless an
   * index pass or a failed load left the entry stale. A different set, or a
   * stale entry, keeps the current counts until the new ones arrive, then
   * drops the menus of pull requests no longer listed. No pull requests, no
   * call.
   */
  async function loadRelatedCounts(
    sessionId: string,
    pullRequests: readonly SessionPullRequest[],
  ): Promise<void> {
    if (pullRequests.length === 0) {
      remove(sessionId);
      return;
    }
    touch(sessionId);
    const signature = pullRequestSignature(pullRequests);
    let entry = entries.get(sessionId);
    if (entry?.signature === signature && !entry.stale) return;
    if (entry) {
      entry.signature = signature;
      entry.stale = false;
    } else {
      entries.set(sessionId, {
        signature,
        counts: null,
        stale: false,
        lists: new Map(),
        guard: markRaw(useAsyncGuard()),
      });
      evict(sessionId);
      // The reactive proxy, which later `entries.get` calls also return.
      entry = entries.get(sessionId);
      if (!entry) return;
    }
    const target = entry;
    const token = target.guard.start();
    const isCurrent = () => entries.get(sessionId) === target && target.guard.isValid(token);
    try {
      const rows = await getSessionPullRequestRelatedCounts(sessionId);
      if (!isCurrent()) return;
      target.counts = new Map(rows.map((row) => [pullRequestKey(row), row.otherSessionCount]));
      const listed = new Set(signature.split("\n"));
      for (const key of [...target.lists.keys()]) {
        if (!listed.has(key)) target.lists.delete(key);
      }
    } catch (e) {
      // The menus are extra: without new counts the old ones stay, or none
      // show, and the next load tries again.
      if (!isCurrent()) return;
      target.stale = true;
      logWarn("[pullRequestSessions] Failed to load counts:", e);
    }
  }

  /** How many other sessions are linked to `pr`; 0 while unknown. */
  function relatedCount(sessionId: string, pr: PullRequestKeyParts): number {
    touch(sessionId);
    return entries.get(sessionId)?.counts?.get(pullRequestKey(pr)) ?? 0;
  }

  function relatedSessions(
    sessionId: string,
    pr: PullRequestKeyParts,
  ): RelatedSessionsState | null {
    return entries.get(sessionId)?.lists.get(pullRequestKey(pr)) ?? null;
  }

  /**
   * Load the sessions linked to `pr`, other than `sessionId`, unless they
   * are loaded or loading. `retry` loads them again after an error. A list
   * an index pass outdated loads again, and stays on screen meanwhile.
   */
  async function loadRelatedSessions(
    sessionId: string,
    pr: PullRequestKeyParts,
    { retry = false } = {},
  ): Promise<void> {
    const entry = entries.get(sessionId);
    if (!entry) return;
    touch(sessionId);
    const key = pullRequestKey(pr);
    const existing = entry.lists.get(key);
    const outdated = existing != null && staleLists.has(toRaw(existing));
    if (existing && !outdated && !(retry && existing.status === "error")) return;
    // A new object either way, so a load still running for the old one is dropped.
    const keep = outdated && existing.status === "ready";
    entry.lists.set(
      key,
      keep ? { ...toRaw(existing) } : { status: "loading", sessions: [], error: null },
    );
    const state = entry.lists.get(key);
    if (!state) return;
    const stillWanted = () => entries.get(sessionId) === entry && entry.lists.get(key) === state;
    try {
      const links = await getPullRequestSessions({
        host: pr.host,
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
      });
      if (!stillWanted()) return;
      state.sessions = links.filter((link) => link.sessionId !== sessionId);
      state.status = "ready";
    } catch (e) {
      if (!stillWanted()) return;
      if (keep) {
        // The outdated list stays; the next open tries again.
        staleLists.add(toRaw(state));
        return;
      }
      state.error = toErrorMessage(e, "Couldn't load the sessions");
      state.status = "error";
    }
  }

  // A pass can link other sessions to these pull requests: every entry and
  // menu list may be out of date. Loads replace them; the old ones stay shown.
  const watchIndexUpdates = useScopedEventListener(IPC_EVENTS.INDEXING_FINISHED, () => {
    for (const entry of entries.values()) {
      entry.stale = true;
      for (const list of entry.lists.values()) staleLists.add(toRaw(list));
    }
    revision.value += 1;
  });

  return {
    revision,
    hasEntry,
    loadRelatedCounts,
    relatedCount,
    relatedSessions,
    loadRelatedSessions,
    watchIndexUpdates,
  };
});
