import type { SessionLiveState } from "@tracepilot/types";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import { useAlertWatcherStore } from "@/stores/alertWatcher";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";
import { useSessionTabsStore } from "@/stores/sessionTabs";

export type SessionLike = { id: string };

export function getMonitoredSessionIds(): Set<string> {
  const ids = new Set<string>();

  try {
    const tabStore = useSessionTabsStore();
    for (const tab of tabStore.tabs) {
      ids.add(tab.sessionId);
    }
    for (const sid of tabStore.popupSessionIds) {
      ids.add(sid);
    }
  } catch {
    /* tab store not available */
  }

  const route = useAlertWatcherStore().capturedRoute as RouteLocationNormalizedLoaded | null;
  const routeId = route?.params?.id;
  if (typeof routeId === "string" && routeId) {
    ids.add(routeId);
  }

  return ids;
}

export function filterSessionsByScope<T extends SessionLike>(sessions: T[]): T[] {
  const prefs = usePreferencesStore();
  if (prefs.alertsScope === "all") {
    return sessions;
  }
  const monitoredIds = getMonitoredSessionIds();
  return sessions.filter((s) => monitoredIds.has(s.id));
}

export function filterSdkStatesByScope(states: SessionLiveState[]): SessionLiveState[] {
  const prefs = usePreferencesStore();
  if (prefs.alertsScope === "all") {
    return states;
  }

  const monitoredIds = getMonitoredSessionIds();
  try {
    const foregroundSessionId = useSdkStore().foregroundSessionId;
    if (foregroundSessionId) {
      monitoredIds.add(foregroundSessionId);
    }
  } catch {
    /* SDK store not available */
  }

  return states.filter((s) => monitoredIds.has(s.sessionId));
}
