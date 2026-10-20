/**
 * The other sessions linked to each of a session's pull requests, for the
 * Overview's "Also in N other sessions" menus.
 *
 * Per open session: the counts load once for each pull-request list the
 * session detail loads (a refresh's new list loads them again), and one pull
 * request's sessions load only when its menu opens, cached until the counts
 * reload. Entries are keyed by session id, so several open session tabs don't
 * evict each other; a response is applied only while its entry is still the
 * current one for that session (a newer load replaces the entry object).
 */
import { getPullRequestSessions, getSessionPullRequestRelatedCounts } from "@tracepilot/client";
import type { PullRequestSessionLink, SessionPullRequest } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { reactive, toRaw } from "vue";
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

export interface RelatedSessionsState {
  status: "loading" | "ready" | "error";
  /** The other sessions; the current one is left out. */
  sessions: PullRequestSessionLink[];
  error: string | null;
}

interface SessionEntry {
  /** The pull-request list the counts were loaded for. */
  source: readonly SessionPullRequest[];
  /** Other-session counts by `pullRequestKey`; null until they load. */
  counts: Map<string, number> | null;
  lists: Map<string, RelatedSessionsState>;
}

/** Open sessions remembered at once; the oldest goes first. */
const MAX_SESSIONS = 20;

export const usePullRequestSessionsStore = defineStore("pullRequestSessions", () => {
  const entries = reactive(new Map<string, SessionEntry>());

  function current(sessionId: string, entry: SessionEntry): boolean {
    return entries.get(sessionId) === entry;
  }

  /**
   * Load the counts for `pullRequests`, the session's list as its detail
   * loaded it. The same list loads nothing again; a new list (a refresh)
   * replaces the counts and every cached menu. No pull requests, no call.
   */
  async function loadRelatedCounts(
    sessionId: string,
    pullRequests: readonly SessionPullRequest[],
  ): Promise<void> {
    const existing = entries.get(sessionId);
    if (existing && toRaw(existing.source) === toRaw(pullRequests)) return;
    if (pullRequests.length === 0) {
      entries.delete(sessionId);
      return;
    }
    entries.delete(sessionId);
    entries.set(sessionId, { source: toRaw(pullRequests), counts: null, lists: new Map() });
    while (entries.size > MAX_SESSIONS) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    // The reactive proxy, which later `entries.get` calls also return.
    const entry = entries.get(sessionId);
    if (!entry) return;
    try {
      const rows = await getSessionPullRequestRelatedCounts(sessionId);
      if (!current(sessionId, entry)) return;
      entry.counts = new Map(rows.map((row) => [pullRequestKey(row), row.otherSessionCount]));
    } catch (e) {
      // The menus are extra; without counts they stay hidden.
      if (current(sessionId, entry)) logWarn("[pullRequestSessions] Failed to load counts:", e);
    }
  }

  /** How many other sessions are linked to `pr`; 0 while unknown. */
  function relatedCount(sessionId: string, pr: PullRequestKeyParts): number {
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
   * are loaded or loading. `retry` loads them again after an error.
   */
  async function loadRelatedSessions(
    sessionId: string,
    pr: PullRequestKeyParts,
    { retry = false } = {},
  ): Promise<void> {
    const entry = entries.get(sessionId);
    if (!entry) return;
    const key = pullRequestKey(pr);
    const existing = entry.lists.get(key);
    if (existing && !(retry && existing.status === "error")) return;
    entry.lists.set(key, { status: "loading", sessions: [], error: null });
    const state = entry.lists.get(key);
    if (!state) return;
    const stillWanted = () => current(sessionId, entry) && entry.lists.get(key) === state;
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
      state.error = toErrorMessage(e, "Couldn't load the sessions");
      state.status = "error";
    }
  }

  return { loadRelatedCounts, relatedCount, relatedSessions, loadRelatedSessions };
});
