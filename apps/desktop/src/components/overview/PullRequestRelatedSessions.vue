<script setup lang="ts">
/**
 * "Also in N other sessions" under a linked pull request on the Overview: a
 * menu of the other sessions linked to it, each opening that session.
 * Renders nothing while the count is unknown or zero, and in pop-out
 * windows, which have no router to open another session with (as other
 * cross-page links there are hidden).
 */
import {
  formatRelativeTime,
  type PullRequestSessionLink,
  pullRequestRoleLabel,
  resolveSessionSource,
  sourceLabel,
} from "@tracepilot/types";
import { Users } from "lucide-vue-next";
import { computed, nextTick, ref, useId, watch } from "vue";
import { useRouter } from "vue-router";
import { useContextMenu } from "@/composables/useContextMenu";
import { useWindowRole } from "@/composables/useWindowRole";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import {
  type PullRequestKeyParts,
  usePullRequestSessionsStore,
} from "@/stores/pullRequestSessions";
import { useSessionTabsStore } from "@/stores/sessionTabs";
import { type MenuPlacement, placeAnchoredMenu } from "@/utils/menuPlacement";

const props = defineProps<{
  sessionId: string;
  pr: PullRequestKeyParts;
}>();

const { isViewer } = useWindowRole();
const router = isViewer() ? null : useRouter();
const related = usePullRequestSessionsStore();
const tabs = useSessionTabsStore();
const menuId = useId();
const statusId = useId();

const count = computed(() => (router ? related.relatedCount(props.sessionId, props.pr) : 0));
const label = computed(() => `Also in ${count.value} other session${count.value === 1 ? "" : "s"}`);
const state = computed(() => related.relatedSessions(props.sessionId, props.pr));
const sessions = computed(() => (state.value?.status === "ready" ? state.value.sessions : []));
const statusText = computed(() => {
  if (!state.value || state.value.status === "loading") return "Loading sessions…";
  if (state.value.status === "error") return "Couldn't load the sessions.";
  return sessions.value.length === 0 ? "No other sessions found." : null;
});
/** The list stops at 100 sessions; the count doesn't. */
const moreCount = computed(() =>
  sessions.value.length > 0 ? Math.max(0, count.value - sessions.value.length) : 0,
);

const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const placement = ref<MenuPlacement>({ x: 0, y: 0, maxHeight: 360 });

function close() {
  open.value = false;
}

// Focus, Esc, arrow keys and Tab; this component places the menu itself.
const { onKeydown } = useContextMenu({ active: open, panel, dismiss: close });

/** Below the trigger, or above it when only that fits; replaced as content changes. */
function place() {
  const anchor = trigger.value?.getBoundingClientRect();
  const menu = panel.value;
  if (!open.value || !anchor || !menu) return;
  placement.value = placeAnchoredMenu(
    anchor,
    { width: menu.getBoundingClientRect().width, height: menu.scrollHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );
}

let resizeObserver: ResizeObserver | null = null;
watch(panel, (el, _, onCleanup) => {
  if (!el) return;
  place();
  window.addEventListener("resize", place);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(place);
    resizeObserver.observe(el);
  }
  onCleanup(() => {
    window.removeEventListener("resize", place);
    resizeObserver?.disconnect();
    resizeObserver = null;
  });
});

// Another session or pull request in this row, or no count left, closes the menu.
watch(
  () => [props.sessionId, props.pr.host, props.pr.owner, props.pr.repo, props.pr.number],
  close,
);
watch(count, (n) => {
  if (n === 0) close();
});

// An open menu whose list went (its counts reloaded for other pull requests) loads it again.
watch([open, state], ([isOpen, current]) => {
  if (isOpen && !current) void related.loadRelatedSessions(props.sessionId, props.pr);
});

// Once the list or its error shows, put focus on its first item unless the
// user has moved it elsewhere, so the arrow keys work straight away.
watch(
  () => state.value?.status,
  (status) => {
    if (!open.value || status === "loading") return;
    void nextTick(() => {
      place();
      const el = panel.value;
      const active = document.activeElement;
      if (!el || (active && active !== document.body && active !== el)) return;
      el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
  },
);

function toggle() {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  void related.loadRelatedSessions(props.sessionId, props.pr);
}

function retry() {
  // The Retry item goes away while loading; keep focus in the menu.
  panel.value?.focus();
  void related.loadRelatedSessions(props.sessionId, props.pr, { retry: true });
}

function sessionTitle(link: PullRequestSessionLink): string {
  return link.summary?.trim() || `Session ${link.sessionId.slice(0, 8)}`;
}

/** What the session did with the pull request, then when it was last updated. */
function sessionDetails(link: PullRequestSessionLink): string {
  const parts = link.roles.map(pullRequestRoleLabel);
  const updated = formatRelativeTime(link.updatedAt);
  if (updated) parts.push(updated);
  return parts.map((part) => ` · ${part}`).join("");
}

/** Ctrl/Cmd+click opens a tab, as on the session list; a click goes there. */
function openSession(event: MouseEvent, link: PullRequestSessionLink) {
  close();
  if (!router) return;
  if (event.ctrlKey || event.metaKey) {
    tabs.openTab(link.sessionId, sessionTitle(link));
    return;
  }
  void pushRoute(router, ROUTE_NAMES.sessionOverview, { params: { id: link.sessionId } });
}
</script>

<template>
  <span v-if="count > 0" class="pr-related">
    <button
      ref="trigger"
      type="button"
      class="pr-related__trigger"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      data-testid="pull-request-related"
      @click="toggle"
    >
      <Users :size="12" aria-hidden="true" />
      {{ label }}
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="pr-related-menu"
        tabindex="-1"
        :style="{
          left: `${placement.x}px`,
          top: `${placement.y}px`,
          maxHeight: `${placement.maxHeight}px`,
        }"
        data-testid="pull-request-related-menu"
        @click.stop
        @keydown="onKeydown"
      >
        <p
          v-if="statusText"
          :id="statusId"
          class="pr-related-menu__status"
          :role="state?.status === 'error' ? 'alert' : 'status'"
        >
          {{ statusText }}
        </p>
        <div
          :id="menuId"
          role="menu"
          :aria-label="`Other sessions linked to #${pr.number}`"
          :aria-busy="!state || state.status === 'loading'"
          :aria-describedby="statusText ? statusId : undefined"
        >
          <button
            v-if="state?.status === 'error'"
            type="button"
            role="menuitem"
            tabindex="-1"
            class="pr-related-menu__item pr-related-menu__retry"
            data-testid="pull-request-related-retry"
            @click="retry"
          >
            Retry
          </button>
          <button
            v-for="link in sessions"
            :key="link.sessionId"
            type="button"
            role="menuitem"
            tabindex="-1"
            class="pr-related-menu__item"
            :title="sessionTitle(link)"
            data-testid="pull-request-related-session"
            @click="openSession($event, link)"
          >
            <span class="pr-related-menu__title">{{ sessionTitle(link) }}</span>
            <span class="pr-related-menu__meta">
              <span
                :class="{ 'pr-related-menu__source--claude': resolveSessionSource(link.source) === 'claudeCode' }"
              >{{ sourceLabel(link.source) }}</span>{{ sessionDetails(link) }}
            </span>
          </button>
        </div>
        <p v-if="moreCount > 0" class="pr-related-menu__status" data-testid="pull-request-related-more">
          and {{ moreCount }} more
        </p>
      </div>
      <div v-if="open" class="pr-related-backdrop" @click="close" @contextmenu.prevent="close" />
    </Teleport>
  </span>
</template>

<style scoped>
.pr-related__trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font: inherit;
  color: var(--text-tertiary);
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}

.pr-related__trigger:hover,
.pr-related__trigger[aria-expanded="true"] {
  color: var(--text-primary);
}

.pr-related-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
}

.pr-related-menu {
  position: fixed;
  z-index: var(--z-modal);
  width: max-content;
  min-width: min(240px, calc(100vw - 16px));
  max-width: min(400px, calc(100vw - 16px));
  overflow-y: auto;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: 4px 0;
}

.pr-related-menu__status {
  margin: 0;
  padding: 8px 12px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.pr-related-menu__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 12px;
  font-size: 0.75rem;
  color: var(--text-primary);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background var(--duration-fast) var(--ease-out);
}

.pr-related-menu__item:hover {
  background: var(--canvas-subtle);
}

.pr-related-menu__item:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: -2px;
  background: var(--canvas-subtle);
}

.pr-related-menu__retry {
  color: var(--accent-fg);
}

.pr-related-menu__title {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr-related-menu__meta {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.pr-related-menu__source--claude {
  color: var(--claude-fg);
}

@media (prefers-reduced-motion: reduce) {
  .pr-related__trigger,
  .pr-related-menu__item {
    transition: none;
  }
}
</style>
