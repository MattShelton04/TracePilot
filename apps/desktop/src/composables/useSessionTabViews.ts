import { usePersistedRef } from "@tracepilot/ui";
import { effectScope, type Ref } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";

/**
 * The session detail sub-tabs' view choices, kept across sub-tab switches,
 * sessions and restarts. Each tab is rendered fresh when it becomes active,
 * so its own refs would otherwise reset every time.
 */
export interface SessionTabViews {
  conversation: "chat" | "compact" | "timeline";
  timeline: "swimlanes" | "waterfall" | "agent-tree" | "messages";
  agentTree: "paginated" | "unified";
  messagesDiagram: "sequence" | "lanes" | "graph";
  messagesPacked: boolean;
  /** Copilot's todos, which often have dependencies. */
  todos: "list" | "graph";
  /**
   * Claude Code's todos: mostly the desktop app's ordered checklist, which
   * has no dependencies, so the list is the default.
   */
  claudeTodos: "list" | "graph";
  metrics: "model" | "agent";
  context: "timeline" | "snapshots";
}

export const DEFAULT_SESSION_TAB_VIEWS: SessionTabViews = {
  conversation: "chat",
  timeline: "agent-tree",
  agentTree: "paginated",
  messagesDiagram: "sequence",
  messagesPacked: true,
  todos: "graph",
  claudeTodos: "list",
  metrics: "model",
  context: "timeline",
};

const ALLOWED: { [K in keyof SessionTabViews]: readonly SessionTabViews[K][] } = {
  conversation: ["chat", "compact", "timeline"],
  timeline: ["swimlanes", "waterfall", "agent-tree", "messages"],
  agentTree: ["paginated", "unified"],
  messagesDiagram: ["sequence", "lanes", "graph"],
  messagesPacked: [true, false],
  todos: ["list", "graph"],
  claudeTodos: ["list", "graph"],
  metrics: ["model", "agent"],
  context: ["timeline", "snapshots"],
};

/** Keep each stored choice that is still an option; default the rest. */
export function readSessionTabViews(raw: string): SessionTabViews {
  const stored = JSON.parse(raw) as Record<string, unknown> | null;
  const views = { ...DEFAULT_SESSION_TAB_VIEWS };
  for (const key of Object.keys(ALLOWED) as (keyof SessionTabViews)[]) {
    const value = stored?.[key];
    if ((ALLOWED[key] as readonly unknown[]).includes(value)) {
      (views as Record<string, unknown>)[key] = value;
    }
  }
  return views;
}

let shared: Ref<SessionTabViews> | null = null;

/**
 * One shared ref for every session tab and window. It lives in a detached
 * scope: its write-back must outlive the tab that first asked for it.
 */
export function useSessionTabViews(): Ref<SessionTabViews> {
  shared ??=
    effectScope(true).run(() =>
      usePersistedRef(
        STORAGE_KEYS.sessionTabViews,
        { ...DEFAULT_SESSION_TAB_VIEWS },
        {
          serializer: { read: readSessionTabViews, write: (value) => JSON.stringify(value) },
        },
      ),
    ) ?? null;
  return shared as Ref<SessionTabViews>;
}

/** For tests: forget the shared ref so the next call reads storage again. */
export function resetSessionTabViews(): void {
  shared = null;
}
