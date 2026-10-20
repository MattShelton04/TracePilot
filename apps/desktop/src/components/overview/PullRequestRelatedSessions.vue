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
import { computed, ref, watch } from "vue";
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

const props = defineProps<{
  sessionId: string;
  pr: PullRequestKeyParts;
}>();

const { isViewer } = useWindowRole();
const router = isViewer() ? null : useRouter();
const related = usePullRequestSessionsStore();
const tabs = useSessionTabsStore();

const count = computed(() => (router ? related.relatedCount(props.sessionId, props.pr) : 0));
const label = computed(() => `Also in ${count.value} other session${count.value === 1 ? "" : "s"}`);
const state = computed(() => related.relatedSessions(props.sessionId, props.pr));

const open = ref(false);
const position = ref({ x: 0, y: 0 });
const trigger = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);

// Placed for its loading line; the list that replaces it scrolls rather than
// running off the bottom of the window.
const menuStyle = computed(() => ({
  left: `${placement.value.x}px`,
  top: `${placement.value.y}px`,
  maxHeight: `${Math.max(120, Math.min(360, window.innerHeight - placement.value.y - 8))}px`,
}));

function close() {
  open.value = false;
}

const { placement, onKeydown } = useContextMenu({
  active: open,
  panel: menuRef,
  position,
  dismiss: close,
});

// Another session or pull request in this row closes the menu.
watch(
  () => [props.sessionId, props.pr.host, props.pr.owner, props.pr.repo, props.pr.number],
  close,
);

function toggle() {
  if (open.value) {
    close();
    return;
  }
  const rect = trigger.value?.getBoundingClientRect();
  position.value = rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 0, y: 0 };
  open.value = true;
  void related.loadRelatedSessions(props.sessionId, props.pr);
}

function retry() {
  void related.loadRelatedSessions(props.sessionId, props.pr, { retry: true });
}

function sessionTitle(link: PullRequestSessionLink): string {
  return link.summary?.trim() || link.sessionId.slice(0, 8);
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
      data-testid="pull-request-related"
      @click="toggle"
    >
      <Users :size="12" aria-hidden="true" />
      {{ label }}
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menuRef"
        class="pr-related-menu"
        role="menu"
        :aria-label="`Other sessions linked to #${pr.number}`"
        :aria-busy="state?.status === 'loading'"
        tabindex="-1"
        :style="menuStyle"
        data-testid="pull-request-related-menu"
        @click.stop
        @keydown="onKeydown"
      >
        <p v-if="!state || state.status === 'loading'" class="pr-related-menu__status" role="status">
          Loading sessions…
        </p>
        <template v-else-if="state.status === 'error'">
          <p class="pr-related-menu__status" role="alert">Couldn't load the sessions.</p>
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="pr-related-menu__item pr-related-menu__retry"
            data-testid="pull-request-related-retry"
            @click="retry"
          >
            Retry
          </button>
        </template>
        <p v-else-if="state.sessions.length === 0" class="pr-related-menu__status">
          No other sessions found.
        </p>
        <template v-else>
          <button
            v-for="link in state.sessions"
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
        </template>
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
