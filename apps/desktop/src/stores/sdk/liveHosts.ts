/**
 * Live attach slice (ADR-0016).
 *
 * Tracks how each session is hosted (`attachable` in a `copilot --ui-server`
 * terminal, `running` in a plain terminal, or `idle`) and attaches to
 * attachable sessions. Attaching joins the terminal's own CLI as an observer,
 * so it never forks the session; it does append one `session.resume` event
 * to the session's history, which is why the backend attaches at most once
 * while a session stays tracked.
 */

import { sdkAttachSession, sdkLiveHosts } from "@tracepilot/client";
import type { BridgeSessionInfo, LiveSessionHost } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { type Ref, shallowRef } from "vue";
import { logInfo, logWarn } from "@/utils/logger";

export interface LiveHostsDeps {
  sessions: Ref<BridgeSessionInfo[]>;
  lastError: Ref<string | null>;
  upsertSession: (session: BridgeSessionInfo) => void;
  markSessionInactive: (sessionId: string) => void;
  clearLiveTurn: (sessionId: string) => void;
}

export function createLiveHostsSlice(deps: LiveHostsDeps) {
  const liveHostsById = shallowRef<Record<string, LiveSessionHost>>({});

  /** Whether `sessionId` is currently attached through a live endpoint. */
  function isAttached(sessionId: string | null | undefined): boolean {
    if (!sessionId) return false;
    return deps.sessions.value.some((s) => s.sessionId === sessionId && s.isActive && s.isRemote);
  }

  /**
   * Refresh hosting state for `sessionIds`. The backend also drops
   * attachments whose terminal went away; mirror that here so the steering
   * UI stops showing a dead live view.
   */
  async function refreshLiveHosts(sessionIds: string[]): Promise<LiveSessionHost[]> {
    if (sessionIds.length === 0) return [];
    try {
      const hosts = await sdkLiveHosts(sessionIds);
      const next = { ...liveHostsById.value };
      for (const host of hosts) {
        next[host.sessionId] = host;
        if (!host.attached && isAttached(host.sessionId)) {
          logInfo("[sdk] Live attachment ended:", host.sessionId, host.state);
          deps.markSessionInactive(host.sessionId);
          deps.clearLiveTurn(host.sessionId);
        }
      }
      liveHostsById.value = next;
      return hosts;
    } catch (e) {
      logWarn("[sdk] Live host lookup failed:", e);
      return [];
    }
  }

  const attachInFlight = new Map<string, Promise<BridgeSessionInfo | null>>();

  /** Attach to a session hosted by a `--ui-server` terminal (coalesced per session). */
  async function attachSession(sessionId: string): Promise<BridgeSessionInfo | null> {
    const pending = attachInFlight.get(sessionId);
    if (pending) return pending;
    const promise = (async () => {
      try {
        const session = await sdkAttachSession(sessionId);
        deps.lastError.value = null;
        deps.upsertSession(session);
        const host = liveHostsById.value[sessionId];
        if (host)
          liveHostsById.value = {
            ...liveHostsById.value,
            [sessionId]: { ...host, attached: true },
          };
        logInfo("[sdk] Attached live session:", sessionId);
        return session;
      } catch (e) {
        deps.lastError.value = toErrorMessage(e);
        logWarn("[sdk] Attach failed:", e);
        return null;
      }
    })();
    attachInFlight.set(sessionId, promise);
    try {
      return await promise;
    } finally {
      attachInFlight.delete(sessionId);
    }
  }

  return { liveHostsById, isAttached, refreshLiveHosts, attachSession };
}
