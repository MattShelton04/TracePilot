import { resolveSessionSource, type SessionSource, sourceCapabilities } from "@tracepilot/types";
import type { RouteLocationNormalized, RouteLocationRaw } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { isSessionTabHidden } from "@/config/sessionTabs";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { useSessionsStore } from "@/stores/sessions";

/**
 * Where to send a deep link to a session tab its source cannot show, or
 * `undefined` to let it through. An unknown source is let through; the
 * detail view re-checks once the session loads.
 */
export function hiddenSessionTabRedirect(
  to: Pick<RouteLocationNormalized, "name" | "params">,
  source: SessionSource | undefined,
): RouteLocationRaw | undefined {
  if (source === undefined || typeof to.name !== "string") return undefined;
  if (!isSessionTabHidden(to.name, sourceCapabilities(source))) return undefined;
  return { name: ROUTE_NAMES.sessionOverview, params: to.params };
}

/** The session's source from data already loaded, without fetching. */
export function knownSessionSource(sessionId: string): SessionSource | undefined {
  const detail = useSessionDetailStore().detail;
  if (detail?.id === sessionId) return resolveSessionSource(detail.source);
  const item = useSessionsStore().sessions.find((s) => s.id === sessionId);
  return item ? resolveSessionSource(item.source) : undefined;
}

/** Router guard: keep deep links off tabs the session's source hides. */
export function sessionTabGuard(to: RouteLocationNormalized): RouteLocationRaw | undefined {
  const id = to.params.id;
  if (typeof id !== "string" || !to.matched.some((r) => r.path === "/session/:id")) {
    return undefined;
  }
  return hiddenSessionTabRedirect(to, knownSessionSource(id));
}
